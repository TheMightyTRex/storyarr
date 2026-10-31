# Setting up Storyarr

After [installing](INSTALL.md), open Storyarr in your browser. The first account you create is the admin
account. Storyarr then takes you through setup, one step at a time. Every step can be skipped and changed later
in **Settings**.

## Setup steps for the admin

| Step | What to do |
|---|---|
| **Metadata** | Connect Hardcover for discovery, series and author lists, or use Open Library without an account. |
| **Libraries** | Connect Audiobookshelf or Grimmory, so Storyarr can see the books you already own. |
| **Download sources** | Choose where to find releases: MyAnonamouse, Prowlarr or AudiobookBay. |
| **Download clients** | Connect qBittorrent for torrents, or SABnzbd or NZBGet for Usenet. |
| **Library folders** | Choose where imported books are saved. Storyarr checks it can read and write each folder. |
| **Sources** | Connect Goodreads, StoryGraph or Hardcover, then choose the lists to keep up with. |
| **Automation** | Choose which kinds of books new follows include, and whether wanted books are searched again. |
| **Layout and display** | Choose Classic or Shelf, a theme, a text size and any reading aids. |

Members see a shorter version: Metadata, download preferences, Sources, Automation and Layout.

## Hardcover token

Hardcover needs a token with these scopes: `read:catalog`, `read:me:content`, `read:lists`,
`read:library:public`, `read:users` and `write:lists`.
[Create a token with those scopes selected](https://hardcover.app/account/api/keys/new?scope=read:catalog+read:me:content+read:lists+read:library:public+read:users+write:lists),
then paste it into **Settings → Sources → Metadata**. [Reading accounts](READING-ACCOUNTS.md) has the details.

## Folders: the part that most often goes wrong

Storyarr, your download client and Audiobookshelf must see the same files. The simplest way is to mount the
same host folder at the same path in every container, for example `/data` in all three.

- Imports copy or hard link finished downloads into your library folders. Hard links only work when the
  download and the library are on the same file system.
- If you use mergerfs or another pooled file system and imports fail with "Source changed while creating its
  hardlink", turn on **Use independent copies** for that library folder, in **Settings → Library → Libraries**.
- [Library folders](LIBRARY-FOLDERS.md) and [download clients](DOWNLOAD-CLIENTS.md) explain path mapping when
  the paths differ.

## Following authors and series

1. Search for an author or series and select **Follow**.
2. Choose the formats and book types to include. Your defaults come from **Settings → Downloads → Automation**.
3. Open **Following**, then **Open bookshelf**, to see every book with its status.
4. Select **Add missing books** to search for everything you do not have yet.

Wanted books that are not found are searched again automatically: after 6 hours, then daily, then weekly.

## Other people in your household

Create accounts in **Settings → Accounts**, or let people sign in with [Plex](PLEX.md) or
[OpenID Connect](OIDC.md). Each person has their own lists and requests. Admins approve requests unless a
person is allowed to download directly.

## Next steps

- [Updating Storyarr](UPDATING.md): how updates reach you, and how to stay in control of them.
- [Notifications](NOTIFICATIONS.md): Discord, ntfy, Apprise and webhooks.
- [Docker settings](DOCKER.md): reverse proxies, backups and every option.
