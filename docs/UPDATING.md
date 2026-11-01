# Updating Storyarr

## How you hear about an update

- **In the app:** Storyarr checks this repository's GitHub releases. When a newer release exists, the version
  note at the bottom of the menu says so, and links to the release notes.
- **On GitHub:** select **Watch → Custom → Releases** on the repository to get an email for each release.

## Upgrading from the release notes

When a newer version is out, the version number in the menu has a red dot and **Upgrade available**. Select it
to open the release notes. They say which version you have and which is available, show **How to upgrade** with
the commands to copy, and link to every earlier release in **Settings → System → Upgrades and backups →
Releases**.

Storyarr runs in a container, and a container cannot replace its own image, so the upgrade itself happens outside
Storyarr. Other *arr apps work the same way in Docker. If you have a page that upgrades your containers, such as
a server dashboard, set `BOOK_UPGRADE_URL` to its address and the release notes show **Upgrade now**, which
opens it.

## Updating

1. Back up the PostgreSQL database and the `config` folder. [Backups](DOCKER.md#backups) shows how.
2. Pull the new image and restart:

   ```sh
   docker compose pull
   docker compose up -d
   ```

3. Open Storyarr. If the update changed anything you should know about, an admin sees the upgrade wizard.

## What happens when Storyarr starts after an update

1. **Settings backup.** Before anything changes, Storyarr saves a copy of your settings (not your library) to
   `config/upgrade-backups`.
2. **Database changes.** Any migrations run. The release notes and the wizard list each change and how to undo
   it.
3. **The upgrade wizard,** for admins: what is new, your backup, new settings to review and the way back. Every
   step is optional, and **Keep the defaults and finish** ends it in one go.

## Automatic upgrades

If you would rather not see the wizard, set `BOOK_UPGRADE_AUTOMATIC=true` on the Storyarr container, or turn
on **Settings → System → Upgrades and backups → Upgrade automatically**. Startup then takes the settings backup,
keeps the defaults for new settings and skips the wizard.

Scripts can do the same after an update with `POST /api/upgrade/automatic` (admin session, CSRF token and an
`Origin` header matching `PUBLIC_URL`).

Tools that update containers on their own, such as Watchtower, work with `latest`. Pair them with automatic
upgrades and nightly database backups, or use [Diun](https://crazymax.dev/diun/) to be told about an update
and choose when to apply it.

## Choosing when you update

`latest` always moves to the newest release. To stay on one release, use its tag, such as
`ghcr.io/themightytrex/storyarr:v0.4.0`, and change the tag when you are ready.

## Going back to an earlier release

Database changes only go forwards when Storyarr starts. To go back:

1. Back up the database.
2. Move the database back to the earlier release, while the newer Storyarr is still running:

   ```sh
   docker exec storyarr python -m app.downgrade <revision>
   ```

   Run it without a revision to list the ones you can choose. Each release's notes give the revision.
3. Change the image tag to the earlier release and run `docker compose up -d`.

To restore only your settings, use **Settings → System → Upgrades and backups → Restore**. Your current
settings are backed up first.

## Release channels

| Tag | Updated when | For |
|---|---|---|
| `latest` | A release is published | Everyone |
| `vX.Y.Z` | Never: it is one release | Choosing when you update |
| `edge` | Every change to `main` that passes the checks | Trying changes early |
