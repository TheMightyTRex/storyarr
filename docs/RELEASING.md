# Releasing Storyarr

For maintainers. GitHub Actions builds, checks and publishes every image; nothing is pushed from a laptop.

## How images are published

| Event | Workflow | Result |
|---|---|---|
| Push to `main` | `container.yml` runs every check and builds amd64 and arm64 images | `ghcr.io/themightytrex/storyarr:edge` |
| Push a tag `vX.Y.Z` on a checked `main` commit | `container.yml` reuses that commit's checked image | `:vX.Y.Z` and `:latest` |
| Run **Publish dev image** by hand | `dev-image.yml` | A `dev-…` tag for trying a branch on one server |

A tag is only published when its version matches `pyproject.toml`, `apps/web/package.json` and the lockfile,
and when `main` at that commit passed its checks.

## Making a release

1. **Version:** set the same `X.Y.Z` in `pyproject.toml`, `uv.lock` (the `dewarr` package entry),
   `apps/web/package.json` and both version fields at the top of `apps/web/package-lock.json`.
2. **Upgrade wizard:** add an entry to `RELEASES` in `services/app/domain/upgrades.py`, newest last:
   highlights, new settings to review, and any database changes with how to undo them.
3. **Database changes:** every migration needs a working downgrade, a test, and a line in
   `services/app/downgrade.py` if people may need to go back past it. Name new migrations
   `storyarr_NNNN_…` so they never clash with a future Dewarr migration of the same number.
4. **Release notes:** write `docs/releases/vX.Y.Z.md`, and add the release to `CHANGELOG.md`.
5. **Checks:** run the server and web test suites (see [Development](DEVELOPMENT.md)).
6. **Publish:** merge to `main` and wait for the **Publish container** run to pass. Then tag and release:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "Storyarr vX.Y.Z" --notes-file docs/releases/vX.Y.Z.md
   ```

The GitHub release is what installed copies see: Storyarr checks this repository's latest release and shows
its notes in the app.

## Screenshots

Documentation screenshots use invented books and generated covers, so no one's library appears:

```sh
cd apps/web
npm run build
npx playwright test --config=playwright.docs.config.ts
```

They are written to `docs/images/`.
