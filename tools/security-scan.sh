#!/usr/bin/env bash
# Runs the free security scanners against this checkout and a throwaway copy of it:  tools/security-scan.sh
#
#   Trivy      known problems in the image's packages and Python libraries, and the Dockerfile's set-up
#   Gitleaks   keys and passwords anywhere in the git history (.gitleaksignore lists prose it mistakes for keys)
#   Bandit     risky patterns in Storyarr's Python code (each reviewed line is marked nosec with its reason)
#   ShellCheck mistakes in the shell scripts
#   Hadolint   the Dockerfile
#   ZAP        a baseline scan of a running throwaway copy, signed out (--full: also an active scan, signed in).
#              The copy, its own PostgreSQL and ZAP share a private Docker network with no way out, so ZAP
#              cannot reach your other apps, this computer or the internet.
#
# Everything runs in Docker from pinned images; nothing is installed and the live server is never touched.
# Needs Docker with buildx, and network access to download the scanners the first time (about 2 GB).
# docs/SECURITY.md explains each warning that is left on purpose.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
NET=storyarr-scan-net
APP=storyarr-scan
DB=storyarr-scan-db
TARGET="http://$APP:8000"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1
TRIVY=aquasec/trivy:0.69.1
ZAP=ghcr.io/zaproxy/zaproxy:stable
OUT="${SCAN_OUT:-$(mktemp -d)}"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$APP" "$DB" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT
failed=0
say() { printf '\n== %s\n' "$*"; }
result() { if [ "$1" = 0 ]; then echo "PASS $2"; else echo "FAIL $2"; failed=1; fi; }
echo "Reports: $OUT"

say "Building a throwaway image of this checkout"
docker buildx build --load -q -t storyarr:scan . >/dev/null || { echo "The image did not build" >&2; exit 1; }

say "Trivy: known problems with a fix, in the image"
# Problems Debian has not fixed yet are listed in the report but do not fail the check: docs/SECURITY.md.
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$HOME/.cache/trivy:/root/.cache" "$TRIVY" \
  image --quiet --scanners vuln,secret --ignore-unfixed --exit-code 1 storyarr:scan
result $? "Trivy image"
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$HOME/.cache/trivy:/root/.cache" -v "$OUT:/out" \
  "$TRIVY" image --quiet --scanners vuln --format json -o /out/trivy-image.json storyarr:scan
docker run --rm -v "$PWD:/src:ro" -v "$HOME/.cache/trivy:/root/.cache" "$TRIVY" config --quiet --exit-code 1 \
  --ignorefile /src/.trivyignore --skip-dirs /src/apps/web/node_modules /src
result $? "Trivy configuration"

say "Gitleaks: the whole git history"
docker run --rm -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  -v "$(git rev-parse --path-format=absolute --git-common-dir)/..:/repo:ro" -v "$PWD/.gitleaksignore:/ignore:ro" \
  zricethezav/gitleaks:v8.28.0 git /repo --no-banner --redact --log-opts=--all --gitleaks-ignore-path /ignore
result $? "Gitleaks"

say "Bandit: medium and high"
docker run --rm -v "$PWD:/src:ro" python:3.12-alpine sh -c \
  "pip install -q bandit >/dev/null 2>&1 && bandit -q -r /src/services/app -ll"
result $? "Bandit"

say "ShellCheck"
docker run --rm -v "$PWD:/mnt:ro" koalaman/shellcheck:v0.11.0 -S warning scripts/*.sh tools/*.sh
result $? "ShellCheck"

say "Hadolint (DL3008, pinning Debian package versions, is left out on purpose: old versions are removed)"
docker run --rm -i hadolint/hadolint:v2.14.0 hadolint --ignore DL3008 --failure-threshold warning - < Dockerfile
result $? "Hadolint"

say "ZAP against a throwaway copy, on a private network"
mkdir -p "$work/config" "$work/data" "$work/zap" && chmod 777 "$work/zap"
docker network rm "$NET" >/dev/null 2>&1
docker network create --internal "$NET" >/dev/null
pw="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
docker run -d --name "$DB" --network "$NET" --tmpfs /var/lib/postgresql -e POSTGRES_DB=storyarr \
  -e POSTGRES_USER=storyarr -e POSTGRES_PASSWORD="$pw" postgres:18 >/dev/null
until docker exec "$DB" pg_isready -U storyarr -d storyarr >/dev/null 2>&1; do sleep 1; done
docker run -d --name "$APP" --network "$NET" -e PUID="$(id -u)" -e PGID="$(id -g)" -e PUBLIC_URL="$TARGET" \
  -e DB_HOST="$DB" -e DB_NAME=storyarr -e DB_USER=storyarr -e DB_PASSWORD="$pw" \
  -v "$work/config:/config" -v "$work/data:/data" storyarr:scan >/dev/null
for _ in $(seq 1 120); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP" 2>/dev/null)" = healthy ] && break
  sleep 2
done
# The warnings explained in docs/SECURITY.md are marked IGNORE in tools/zap-rules.tsv.
cp tools/zap-rules.tsv "$work/zap/rules.tsv"
docker run --rm --network "$NET" -v "$work/zap:/zap/wrk:rw" "$ZAP" \
  zap-baseline.py -t "$TARGET" -m 3 -c rules.tsv -J baseline.json > "$work/zap/baseline.txt" 2>&1
cp "$work/zap/baseline.txt" "$work/zap/baseline.json" "$OUT/" 2>/dev/null
grep -E "^(FAIL|WARN)-NEW" "$work/zap/baseline.txt"
grep -q "FAIL-NEW: 0.*WARN-NEW: 0" "$work/zap/baseline.txt"
result $? "ZAP baseline, signed out (any WARN-NEW or FAIL-NEW above needs a look)"

if [ "$FULL" = 1 ]; then
  say "ZAP active scan, signed in (up to 60 minutes)"
  # The first administrator, with a made-up password, made from inside the copy: nothing outside the private
  # network can reach it. Prints the session cookie and the CSRF token the pages send with every change.
  setup='import http.client, json, secrets
c = http.client.HTTPConnection("127.0.0.1", 8000, timeout=30)
c.request("POST", "/api/auth/bootstrap", json.dumps({"username": "scan", "display_name": "Scan",
          "password": secrets.token_urlsafe(18)}),
          {"Content-Type": "application/json", "Origin": "'"$TARGET"'"})
r = c.getresponse()
body = json.loads(r.read())
print(r.getheader("Set-Cookie").split(";")[0])
print(body["csrf_token"])'
  mapfile -t auth < <(docker exec "$APP" python -c "$setup")
  rules=""
  i=0
  for pair in "Cookie=${auth[0]}" "X-CSRF-Token=${auth[1]}" "Origin=$TARGET"; do
    rules="$rules -config replacer.full_list($i).description=h$i -config replacer.full_list($i).enabled=true"
    rules="$rules -config replacer.full_list($i).matchtype=REQ_HEADER -config replacer.full_list($i).matchstr=${pair%%=*}"
    rules="$rules -config replacer.full_list($i).regex=false -config replacer.full_list($i).replacement=${pair#*=}"
    i=$((i + 1))
  done
  docker run --rm --network "$NET" -v "$work/zap:/zap/wrk:rw" "$ZAP" \
    zap-full-scan.py -t "$TARGET/" -j -m 5 -T 60 -c rules.tsv -J full.json -z "$rules" > "$work/zap/full.txt" 2>&1
  cp "$work/zap/full.txt" "$work/zap/full.json" "$OUT/" 2>/dev/null
  grep -E "^(FAIL|WARN)-NEW" "$work/zap/full.txt"
  grep -q "FAIL-NEW: 0.*WARN-NEW: 0" "$work/zap/full.txt"
  result $? "ZAP active scan, signed in"
fi

say "Done"
if [ "$failed" = 0 ]; then echo "Every scanner passed."; else echo "Something needs a look: see FAIL above."; fi
exit "$failed"
