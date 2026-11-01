# Moving from Dewarr to Storyarr

Storyarr is a fork of Dewarr v0.3.9. It uses the same database, settings, folders and environment variables,
so moving is a change of image. Your accounts, lists, follows, requests, library links and download history
all carry over.

This was tested end to end: Dewarr v0.3.9 → Storyarr v0.4.0 → back to Dewarr v0.3.9, with no errors.

## Before you start

- **Your Dewarr version:** these steps are for Dewarr v0.3.9. On an older Dewarr, update to v0.3.9 first and let
  it start once. Dewarr releases newer than v0.3.9 are not supported yet, because their database changes are
  not in Storyarr.
- **Back up** the database and the `config` folder:

  ```sh
  docker exec dewarr-postgres pg_dump -U dewarr -d dewarr --clean --if-exists | gzip > dewarr-before-storyarr.sql.gz
  tar -czf dewarr-config-before-storyarr.tar.gz config
  ```

  Use your own container, user and database names. They are the `DB_*` values in your compose file.

## Switching

1. In your compose file, change the image:

   ```yaml
   image: ghcr.io/logabell/dewarr:latest
   ```

   to

   ```yaml
   image: ghcr.io/themightytrex/storyarr:latest
   ```

   Keep everything else the same: the environment, the `config` and data volumes, the database and the port.
   Renaming the service or container from `dewarr` to `storyarr` is optional.

2. Start it:

   ```sh
   docker compose pull
   docker compose up -d
   ```

3. Watch the first start:

   ```sh
   docker compose logs -f
   ```

   You should see "Saved a settings backup before upgrading", then three database migrations, then
   "Starting Storyarr".

4. Open Storyarr and sign in as before. Admins see the upgrade wizard. It lists what is new, the settings
   backup, new settings worth a look and the way back.

## What changes on first start

| Change | Details |
|---|---|
| Settings backup | Saved to `config/upgrade-backups` before anything else changes. |
| `0081_automation_settings` | Stores defaults for new follows. |
| `0082_installation_automation` | Stores install-wide settings, such as how long deleted books are kept. |
| `0083_operation_lookups` | Two indexes that make request counts and background jobs much faster. |

Nothing is deleted. New settings start at their defaults, which match how Dewarr behaved.

The `x-dewarr-proxy-token` header, the `dewarr-` download folder prefix and every `BOOK_*` variable keep their
names, so reverse proxies and download clients need no changes.

Since v0.4.6 the default `DB_NAME` and `DB_USER` are `storyarr`. Dewarr's compose examples set both to `dewarr`,
so they keep working. If yours leaves them out, add `DB_NAME: dewarr` and `DB_USER: dewarr` before switching.

## Going back to Dewarr

1. Back up the database.
2. With Storyarr still running, move the database back to Dewarr v0.3.9:

   ```sh
   docker exec storyarr python -m app.downgrade 0080_member_setup
   ```

   Use your container's name if it is still called `dewarr`. This removes only Storyarr's additions: the
   follow defaults, the install-wide settings and the two indexes.

3. Change the image back to `ghcr.io/logabell/dewarr:v0.3.9` and run `docker compose up -d`.

Dewarr will not start on a database Storyarr has changed until you do step 2, because it does not know the newer
migrations.

## Questions

- **Do my followed authors and series keep working?** Yes. Storyarr adds a status for every book and a
  bookshelf page for each follow, from the same follows.
- **Do I lose the Classic look?** No. Classic is still there: Storyarr starts in Classic with the light theme,
  and **Settings → General** switches between Classic and Shelf, and between light and dark.
- **Will Dewarr fixes reach Storyarr?** Storyarr is based on Dewarr v0.3.9. Bringing in later Dewarr releases is
  planned, and each release's notes will say what came in.
