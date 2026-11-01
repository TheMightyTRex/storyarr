# Installing Storyarr

Storyarr runs as two containers: Storyarr itself and PostgreSQL 18. It handles its own database migrations and
background jobs, so you do not need Git, Python or a setup script.

Moving from Dewarr? Read [Moving from Dewarr](MIGRATING.md) instead. Your existing database carries over.

## What you need

- Docker with Docker Compose, on Linux (amd64 or arm64), a NAS or a home server.
- About 1 GB of disk for the image, plus room for your database.
- The folders where your downloads and audiobook library live, so you can mount them into the container.

## Image tags

| Tag | What it is |
|---|---|
| `ghcr.io/themightytrex/storyarr:latest` | The newest stable release. Recommended. |
| `ghcr.io/themightytrex/storyarr:v0.4.0` | One exact release. Use this to choose when you upgrade. |
| `ghcr.io/themightytrex/storyarr:edge` | The newest checked build of `main`. For testing. |

## Option 1: Docker Compose (recommended)

1. Make a folder for Storyarr and save [`compose.yaml`](../compose.yaml) in it:

   ```sh
   mkdir storyarr
   cd storyarr
   curl -fsSL https://raw.githubusercontent.com/TheMightyTRex/storyarr/main/compose.yaml -o compose.yaml
   ```

2. Edit `compose.yaml`:
   - Set both `change-me` passwords to the same long, random value.
   - Set `PUID` and `PGID` to the user that owns your library folders (run `id` to see yours).
   - Set `PUBLIC_URL` to the address you will open, such as `http://192.168.1.10:8000`.
   - Add your download and library folders under `volumes`, for example `- /mnt/media:/data`.
   - The containers are named `storyarr` and `storyarr-postgres`. To run a second copy on the same machine,
     change or remove the `container_name` lines.

3. Start it:

   ```sh
   mkdir -p config data
   docker compose up -d
   ```

4. Open the address you set in `PUBLIC_URL` and follow [Setting up Storyarr](SETUP.md).

## Option 2: Docker run

Change both `change-me` passwords to the same value first.

```sh
mkdir -p config data
docker network create storyarr
docker volume create storyarr-postgres

docker run -d --name storyarr-postgres --network storyarr \
  -e POSTGRES_DB=storyarr -e POSTGRES_USER=storyarr -e POSTGRES_PASSWORD=change-me \
  -v storyarr-postgres:/var/lib/postgresql \
  --restart unless-stopped postgres:18

docker run -d --name storyarr --network storyarr \
  -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC \
  -e PUBLIC_URL=http://localhost:8000 \
  -e DB_HOST=storyarr-postgres -e DB_NAME=storyarr -e DB_USER=storyarr -e DB_PASSWORD=change-me \
  -p 8000:8000 -v "$PWD/config:/config" -v "$PWD/data:/data" \
  --stop-timeout 35 --restart unless-stopped \
  ghcr.io/themightytrex/storyarr:latest
```

Already have PostgreSQL 16 or later? Skip the first container and point `DB_HOST`, `DB_NAME`, `DB_USER` and
`DB_PASSWORD` at an empty database there.

## Settings you can add

| Setting | What it does |
|---|---|
| `TZ` | Your time zone, such as `Europe/London`. Release days and schedules use it. |
| `UMASK` | File permissions for new files. The default `002` lets your group write. |
| `BOOK_UPGRADE_AUTOMATIC=true` | Upgrades finish on their own: a settings backup is taken and new settings keep their defaults. See [Updating](UPDATING.md). |
| `BOOK_PROXY_TOKEN` | For reverse proxies. See [Docker settings](DOCKER.md). |

[Docker settings](DOCKER.md) covers folders, reverse proxies, backups and every other option.

## Keep these safe

- The `config` folder. It holds the encryption key for your saved passwords and tokens, and settings backups.
- The PostgreSQL volume. It holds everything else.

Back up both before you update. [Backups](DOCKER.md#backups) explains how.
