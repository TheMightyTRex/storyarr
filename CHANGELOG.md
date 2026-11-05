# Changelog

All notable changes to Storyarr are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with dates written as in the TRex Design System.
Version numbers do not follow [Semantic Versioning](https://semver.org/): database changes and removed features
have come in releases that change only the last number. Storyarr is a fork of
[Dewarr](https://github.com/logabell/dewarr) v0.3.9 by logabell. Release notes for each version are in
[docs/releases](docs/releases).

## [Unreleased]

The database gains two columns for the radio library review (`storyarr_0090_radio_review`). To go back to
v0.6.0, run `python -m app.downgrade storyarr_0089_radio_library` in the Storyarr container first.

### Added
- **Review the radio library** (My library, Radio): the shows in the radio library that are not in your radio
  shows, each with Find on the BBC (the show then takes that folder's files, whatever it is called) or Already
  added, and the files that match no episode, each with a list of the show's episodes to link it by hand.
- **Not this file** on an episode's file, and **Match automatically again** after a choice by hand. The radio
  library sync keeps choices made by hand.
- **Change password.** In Settings, Sign-in, change your own password. Your other browsers and devices are
  signed out.
- **Set new password.** In an account's details, an administrator sets a new password for someone else, who is
  signed out everywhere.
- **Send feedback.** Under the version number, in the side menu and the phone menu: report a problem or suggest
  something, shown on the page or recorded as steps, sent as a GitHub issue. It uses
  [Snaglist](https://github.com/TheMightyTRex/snaglist), which loads only when you select it and records nothing
  personal.
- **Discover, For you** has Books and Radio tabs: five stations, top shows and a genre choice.

### Changed
- **Add a show** also looks in the BBC programmes A to Z when BBC Sounds has no show of that name, so older
  shows such as Cabin Pressure and Old Harry's Game are found by name.
- **Confirmations are toasts:** a card in the corner, up to three stacked, that waits while the pointer or
  keyboard focus is on it. About 10 actions confirm this way.
- **Settings pages say "Saved at 16:31"** beside Save, on about 14 settings sections, until the next change.
- **Display** is an icon button, and Reduce motion is Match device, On or Off. Saved choices carry over.
- **Words:** settings are activated and deactivated, and are active or inactive, on every page and state chip.

### Fixed
- **Dates** are written the same way on every page, whatever your browser's language: "12 May 2020", never
  "12/05/2020" or "May 12, 2020".

### Security
From GitHub's code scanning of 5 November 2026. Each fix has a test.
- **Settings backups:** a backup is found only by its exact name, and only inside the backups folder.
- **Cover pictures** show only from web addresses, Storyarr's own addresses and inline images.
- **Goodreads shelves:** the profile number is matched as plain text.
- **Logo search:** a series name with a long run of spaces no longer slows the search down.

From the security check of 3 November 2026. Each fix has a test.
- **Libraries updated** to versions without known problems: Pillow 13, Authlib, cryptography 50, oauthlib 4,
  pypdf, certifi, joserfc and Mako. The image also takes Debian's security updates when it is built, and leaves
  out pip, which is not used at run time.
- **Identity providers:** with **Match existing accounts** set to **Verified email**, a provider account with an
  administrator's email no longer signs in as that administrator.
- **Large requests:** a request body over 5 MB is refused before it is read.
- **Saved keys stay with their address:** changing an Audiobookshelf or Grimmory connection's address needs its
  key or password typed again.
- **Less shown before signing in:** the version, the release notes and the upgrade page need a signed-in
  account, and the API map (`/openapi.json`, `/docs`, `/redoc`) is no longer served.
- **Old sign-ins are cleared:** expired sessions and old sign-in counters are deleted each night.
- **Logos:** CSS escapes are removed from uploaded SVG logos.
- **A malformed security token** is refused (403) instead of causing a server error.

## [0.6.0] (2 November 2026)

The database gains a table for the radio library (`storyarr_0089_radio_library`). To go back to v0.5.9, run
`python -m app.downgrade storyarr_0088_series_logos` in the Storyarr container first.

### Added
- **Radio library:** choose an Audiobookshelf podcast library for radio in Settings, Connections. Storyarr reads
  it every 15 minutes and shows the episodes it holds as in your library, matched by the BBC programme ID, then
  by series and episode number, then by title. An episode in the library names its file.
- **Filing radio** (for later versions to use): one folder per show, named like Show - S20E03 - Title, with the
  show, series, episode, date and station written into a copy of the file. The original is never changed.
- **Change logo has one editor** for a cover, a file you upload and a logo found online: choose the area, the
  shape by lightness or transparency, clean up specks at four strengths, and an eraser and paintbrush with Undo.

### Changed
- **My library, Series and Authors** show the list beside the chosen one, whose pane is its own page header with
  the logo or portrait, the facts, the actions and a fan of covers. Radio shows follow the same design.
- **Scroll bars** are thin and square, in the border colour, on every page. High contrast uses the text colour.

### Fixed
- **Change logo previews** show for uploaded and found logos, and the Text colour and Accent colour buttons
  change them.

## [0.5.9] (2 November 2026)

Nothing to choose, and no database changes. To go back to v0.5.8, run that version again.

### Changed
- **Display and accessibility** opens as a slide-out from the right, with Done and Reset at the bottom and Match
  device as the first theme.
- **Slide-out headers** match the page behind them; the panel body is the raised surface. The phone menu too.
- **The chosen option** is teal everywhere (main menu, onboarding steps, switches, Activity filters and Settings
  boxes), with a tick or a bar as well as the colour.
- **Buttons** such as Save changes keep the library's size and weight.
- **One focus ring** of 3px on every control, in the High contrast colour when High contrast is on.
- **High contrast** uses the shared library's colours for panels, muted text and dividers.
- **Dates, times and numbers** are British on every page, whatever the browser's language.
- **Wording:** "catalogue", no dashes in empty cells (Not known or None), and plainer headings and messages.

### Fixed
- **Notifications:** Delete asks first, and says the delivery history goes too.
- **Users and access** stacks on phones and at large text sizes, with compact 32px buttons.

## [0.5.8] (2 November 2026)

Versions 0.4.9 to 0.5.7 were never published: the version moved from 0.4.8 straight to 0.5.8. New tables for
radio (`storyarr_0087_radio_shows`) and series logos (`storyarr_0088_series_logos`); to go back to v0.4.8, run
`python -m app.downgrade storyarr_0086_notification_title` in the Storyarr container first, and logo and radio
image files stay in the config folder.

### Added
- **Series header with a logo:** a series page opens with the series logo above the name, in one colour that
  suits the theme. Without a logo, the name is set large as a wordmark. Beside it: the author, the number of
  books, the next book, a short description, how many you have, Add missing books and Follow, with a fan of the
  first covers (not on phones).
- **Change logo** (admins): cut a logo out of one of the series' covers (From a cover), find one on Wikimedia
  Commons with its licence shown (Find online), or upload a file. Logos are for everyone and are saved on the
  server, in the config folder (`series-logos`). Radio show pages have the same logo tools.
- **Cover actions:** every cover in a grid or shelf has Details, Ebook, Audiobook, Add to a list and More.
  Pressing the cover or the title opens the book's Summary. Choose On the cover (shown when you point at it or tab
  to it, and always on touch screens) or Beside the cover in Settings, General, Cover actions, in onboarding and
  in the upgrade wizard. It is saved with your account. A format already in your library shows a tick and
  "in library" in its name.
- **Actions on book rows and small covers:** a series' reading order, search results and Following have the same
  actions at the end of each row. Small tiles (series gaps, calendar days) have one More button that names each
  action.
- **Radio, an early feature:** add BBC radio shows by link or by name, and browse shows, stations, series and
  episodes in My library, Radio. Artwork and station logos are saved on your server. Downloading episodes and
  filing them in Audiobookshelf come in a later version.
- **New screenshots:** cover actions, a Discover shelf, the series header, a reading order, radio and the Cover
  actions setting.

### Changed
- **Header:** each page's tabs have a row of their own in the header, with icons. On phones, the menu holds search
  as well as every section and its pages.
- **One slide-out for every panel:** the Summary, the bookshelf drawer, the calendar day and the phone menu open
  and close the same way: Escape, Close or a press outside closes them, and focus goes back where it was.
- **Teal accent** in every theme.
- **Status chips:** an icon and the same words on every page: In library, Downloading, Waiting, Wanted and the
  rest, in Activity, Following, My library, the book page, Library review, connections, logs and imports.
- **44px controls:** buttons, fields and menus share one height. Each Settings section has one bar to save or
  discard changes, saying how many are unsaved.
- **Discover shelves:** no scroll bars. The covers fade at each end, with an arrow when there are more books that
  way. Tabbing to a book scrolls it into view.
- **Covers line up:** titles always take two lines of space, so covers in a row stay the same size. Covers on In my
  libraries are 10% larger.
- **Release notes window:** the header shows Current version and Available, with View on GitHub beside it; the
  release is headed by its version and date only; earlier releases moved to Settings.
- **How to upgrade:** when a newer version is out, the release notes show the steps and the commands to copy, and
  **Upgrade now** when `BOOK_UPGRADE_URL` points to your own upgrade page.
- **Releases in Settings:** System, Upgrades and backups, Releases lists every release in a fold, newest first,
  marking the current version (open) and any newer one.
- **Bigger covers on My library,** with a cover size setting in Settings, General: Small, Medium (the new,
  larger default) or Large, saved with your account.
- **Header buttons:** search and every header button share one height (44px), and the header holds only the
  page's tabs, search and Display.
- **Lists menu:** on Discover, Add list and Refresh lists are now one Lists menu on the page: Add list, Refresh
  all lists, and refresh Goodreads, StoryGraph or Hardcover lists only. The connection warning sits beside Lists.
- **One header for every pop-up:** release notes, the Display dialog and every other pop-up now have the
  slide-out panels' header: the name in bold at the same size, the close button, a white bar and a grey line.
- **NZBGet:** the README and the download client guide now list NZBGet beside SABnzbd for Usenet, with setup
  steps for both. NZBGet has been supported since v0.2.0, in Settings and in the setup wizard.

### Removed
- **One layout:** the Classic layout is retired, and everyone uses Shelf (the icon menu, with the page's tabs in
  the header, and the menu drawer on phones). The Layout choice is gone from Settings, onboarding and the upgrade
  wizard; installs that chose Classic open in Shelf.

### Fixed
- **British release dates:** release dates show in British style (1 Nov 2026) whatever the browser's language.
- **Libraries on Unraid user shares with a cache pool, and on mergerfs pools:** imports no longer stop with
  "Destination mount changed before publication" when the library folder reports a new identity after the
  first write ([Dewarr #61](https://github.com/logabell/dewarr/issues/61)). The fix came with Dewarr v0.3.9 and
  is in every Storyarr release; earlier notes did not name Unraid or mergerfs. The download client guide now
  explains it, including what to do with an import planned before the fix.
- **Cover actions examples and the Display dialog:** in Settings, the Cover actions examples keep every button on
  the cover, and the first line of the Display dialog no longer sits under its header.

## [0.4.8] (1 November 2026)

No database changes. To go back to v0.4.7, change the image tag and recreate the container.

### Changed
- **Library tabs, one toolbar:** In my libraries, Authors, Series and All saved titles share one section header
  and toolbar: the tab's heading and count, the view switch, search, format chips, the Library filter,
  Sort (with Reverse order on Authors and Series), then a row of applied filters with Clear all and how many show.
- **Phone menu:** on phones the bottom bar is replaced by a menu button in the header (with the red dot when an
  upgrade is available). It opens a drawer from the left with Library, Discover, Activity and Settings, each
  folding open to its sub-menu, plus your account, Sign out and the version. The header sub-menu row is hidden on
  phones, because the drawer holds it.
- **Filters keep up with quick changes everywhere:** every filter, sort and toggle (Library tabs, Library
  review, Following, the series page, Activity history and the Discover filters) now starts from the page's current
  address, so a second change made straight after the first no longer drops it.
- **Save as default:** each Library tab can save its filters and order as the person's default, stored with their
  account, not the browser. Settings, General, Saved views lists them and resets them to default.
- **Upgrade available:** a red dot on the version number, and "Upgrade available" instead of "Update", when a
  newer release is out.
- **Quieter upgrades:** the upgrade wizard opens only when a version brings settings to choose, or
  configuration or database changes. Other upgrades finish on their own after the settings backup.
- **Restore previous version** in Settings, System, Upgrades and backups replaces the wizard's way-back step:
  restore your settings, undo database changes, then start the previous image.
- **One typeface:** Atkinson Hyperlegible Next on every page, replacing the system, serif and monospace fonts.
- **Slide-out panels** (My library summary, the bookshelf drawer, the calendar day) share one header: the name in
  bold on a white bar with a grey line, and the close button.

### Removed
- **Low-vision font:** the Display panel's Low-vision font switch is removed, because every page uses
  Atkinson Hyperlegible Next.

## [0.4.7] (1 November 2026)

No database changes. To go back to v0.4.6, change the image tag and recreate the container.

### Fixed
- **Soulseek (slskd) connection with a read-write API key:** slskd 0.26 shares its download folder only with
  administrator keys, so the test failed with a misleading "use a read-write key" message. Storyarr now checks
  the key before the Soulseek session and says to give the key the administrator role. The settings page and the
  download clients guide say the same. ([#1](https://github.com/TheMightyTRex/storyarr/issues/1))

## [0.4.6] (1 November 2026)

Migration `storyarr_0086_notification_title` retitles stored notifications. To go back to v0.4.5, run
`python -m app.downgrade storyarr_0085_user_preferences` in the Storyarr container first.

### Changed
- **Storyarr everywhere:** notifications are titled "Storyarr notification", including stored ones. The default
  `DB_NAME` and `DB_USER` are `storyarr`, and the package, logger, sample compose overrides, CI images and the
  Docker and development guides use Storyarr names. The `x-dewarr-proxy-token` header and the `dewarr-` download
  folder prefix keep their names.
- **My library summary:** the author and series names open their pages, and a click outside the panel closes it
  (the close button and Escape still work).
- **Container names:** `compose.yaml` names the containers `storyarr` and `storyarr-postgres`, matching the
  `docker run` guide.
- **Rename script:** `scripts/storyarr_rename.py --apply` also restores the lowercase names Storyarr changed,
  after a Dewarr merge.

### Fixed
- **Build and development compose files:** `deploy/compose.build.yaml` and `deploy/compose.dev.yaml` named a
  `dewarr` service and Dewarr's image and release feed, so they did not apply to `compose.yaml`.

## [0.4.5] (1 November 2026)

No database changes. To go back to v0.4.4, change the image tag and recreate the container.

### Changed
- **My library bookshelf:** a compact cover wall. Clicking a book slides out a summary from the right: cover,
  author, series, formats you have, rating, published, narrator, length and description, with Open book page.
  Covers no longer show Quick add or the in-library tick; getting a missing format is in the summary.
- **Loading bar during source searches:** source searches keep the loading bar under the header on while they
  run (book Sources, Quick add, Settings, Sources).

### Fixed
- **Connection repair after a switch to copy:** connection repair accepts a library that switched from hardlink
  to copy after the download was chosen, so held downloads no longer stop at "The library destination changed".

## [0.4.4] (31 October 2026)

No database changes. To go back to v0.4.3, change the image tag and recreate the container.

### Added
- **Sort by** on Series, Authors and Following: Newest, Number of books, Date published, Author (by surname)
  or A to Z, with Reverse order.
- **Download releases Storyarr could not confirm:** Review release lets an administrator confirm the title and
  author, or an unstated language, before downloading. Recorded in the audit log as
  `acquisition.release-override`.
- **Download unconfirmed releases** permission, for people who are not administrators.
- **Review sources on Requests:** the request's status and the book's sources in a dialog.

### Changed
- **Release matching:** release names crediting every co-author now match the book; "Series by" and "books 1 to
  5" names are collections.
- **Series grouping:** series group together when names differ only in punctuation, a leading "The" or a
  trailing "Series".
- **In library first:** followed series and authors in My library open on In library.

## [0.4.3] (31 October 2026)

Migration `storyarr_0085_user_preferences` stores each person's layout choice. To go back to v0.4.2, run
`python -m app.downgrade storyarr_0084_background_work` in the Storyarr container first.

### Changed
- **Series, Authors and Following layouts:** List and detail (the default) or List, with the switch next to the
  search. The choice is saved with each person's account. Covers, the author's picture beside the name,
  progress, statuses and actions sit in the same place on every row. Following shows the chosen follow's
  bookshelf beside the list.

## [0.4.2] (31 October 2026)

Migration `storyarr_0084_background_work` stores the setting. To go back to v0.4.1, run
`python -m app.downgrade 0083_operation_lookups` in the Storyarr container first.

### Added
- **Background work** (Settings, System): choose how often scheduled jobs run: Normal, Relaxed (×5), Light
  (×20) or Minimal (×50). Normal keeps the usual schedule; a change applies within a minute. The upgrade wizard
  offers it as a new setting.

## [0.4.1] (31 October 2026)

### Fixed
- **Release notes window:** left-aligned in the Shelf layout, with bold section headings. Long list items stay
  together, numbered lists work, and the release title is not repeated.

## [0.4.0] (31 October 2026)

The first Storyarr release.

### Added
- **Docker image** for amd64 and arm64 at `ghcr.io/themightytrex/storyarr`: `latest` for releases, `vX.Y.Z` to
  pin one, `edge` for the newest checked build. Built and checked by GitHub Actions.
- **Guides:** installing, setting up, updating, moving from Dewarr, and releasing (for maintainers).
- **New screenshots** with invented books and generated covers.
- **Going back to an earlier release:** `docker exec storyarr python -m app.downgrade <revision>` moves the database
  back, for example to Dewarr v0.3.9 (`0080_member_setup`). Tested both ways.
- **Upgrade wizard title** shows the version number, such as "Welcome to version 0.4.0".
- **Browser tabs:** each tab is named after its page.
- **Calendar Show menu:** covers on the calendar, and which sources and authors appear. Saved in each browser.
- **Bookshelf drawer:** Search now, and Exclude from this follow (or Include again).
- **Loading bar:** a thin bar under the header while a page is fetching data.
- **Upgrade wizard:**
  - Before an existing install upgrades, Storyarr saves a settings backup to `/config/upgrade-backups`.
  - Admins then get a wizard: what is new, the backup to download, new settings to review, and the way back
    (restore settings from a backup; your current settings are saved first).
  - New installs get onboarding instead.
  - Also in Settings, System, Upgrades and backups.
  - **Automatic upgrades:**
    - "Keep the defaults and finish" in the wizard.
    - An "Upgrade automatically" setting (or `BOOK_UPGRADE_AUTOMATIC=true`), so startup backs up and keeps
      the defaults.
    - `POST /api/upgrade/automatic` for scripts.
  - The title names the version, and new settings open in place.
- **Audible matching:** when matching a library audiobook, **Search Audible** lists recordings with narrator,
  length, series, year, and ASIN. A "Narrator matches" tag marks recordings read by the same narrator. Choosing
  one adds it to the catalog and matches it.
- **Audible store setting:** Settings, Reading, Metadata, Audible store (United States, United Kingdom, and
  eight others). It is suggested from your browser's country.
- **Search again for wanted books:**
  - When a quick-add search finds no suitable release, the book is now searched again automatically: after 6
    hours, then daily for a week, then weekly. Before, this only happened for books with a known release day.
  - Older wanted requests were added too.
  - **Setting:** Settings, Automation, Wanted books (on, for audiobooks and ebooks), also in onboarding.
  - Followed books show the next automatic search time instead of "not searched automatically".
- **Header sub-menus (Shelf layout):** each section's sub-menu is a second row of the fixed header, with icons
  and square corners.
  - **Library:** My library, Following, and Library review.
  - **Discover:** For you, Your series, Browse, Calendar, Collections, Awards, and Your lists.
  - **Activity:** the request filters, with counts.
  - The current page has a bar under it. Classic keeps the tabs inside each page.
- **Bookshelf page for each follow:** "Open bookshelf" on Following and on library series cards.
  - **Header:** the series or author, a progress bar of released books in your library, and excluded and
    not-yet-released counts. It also has Add missing books, Manage follow, and a link to the series or author
    page.
  - **Cover wall:** every book has a status chip, and status filter chips sit above. Excluded books are faded.
  - **Side drawer:** selecting a cover shows the book's status and detail, with Open book page and, where it
    applies, Open in Activity. Escape closes it.
- **Light theme, now the default:** every page has a light theme. Dark and Match device are options, and dark
  keeps the original look.
- **Display and accessibility settings:** a Display button at the far right of the header, Settings, General,
  and the onboarding "Layout and display" step. Settings are theme, text size (100% to 175%), low-vision font,
  high contrast, reduce motion, underline links, and wider text spacing, plus Reset. Choices are saved in each
  browser.
- **Fixed header:** the search header stays at the top of every page while you scroll, with Display always at
  its far right. On phones, header buttons show icons only.
- **Layout setting:** Settings, General and a new onboarding step offer Classic or Shelf.
  - **Classic (default):** the original menu.
  - **Shelf:** a slim icon menu with Library, Discover, Activity, and Settings. My library, Following and Library
    review are tabs inside Library. On phones the menu is a bar along the bottom.
  - The choice is saved in each browser.
- **Delete library books** (admin): Delete in the book overview's actions and on each library copy (book page
  and My Library). The pop-up warns what is removed, how to recover it, and what blocking does; afterwards it
  shows the recovery steps with exact paths.
  - **Default:** moves the files to a hidden holding folder in the library and removes the book from
    Audiobookshelf.
  - **Delete permanently:** Audiobookshelf deletes the files, after you type DELETE to confirm.
  - **"Block this book from future downloads" (on by default):** cancels your requests, excludes the book from
    follows and Hardcover lists, and removes it from your lists that download automatically.
- **Deleted-books retention** (Settings, Automation, admins): held books are deleted permanently after this
  many days (default 30; 0 = never), by a nightly job.
- **"Add missing books":** a pop-up on followed authors and series, series and author pages, and library series
  cards. You choose media and book types (from your defaults, or save new ones), and it searches for every
  missing book, with no 25-book limit. Before you start, it lists every book it will search for.
- **Book statuses:** every book in a followed author or series shows one status, with filter chips and counts.
  - The statuses are In library, Downloading %, Importing, Searching, Waiting (with next search time),
    Not released, Needs attention, Wanted, Excluded (with the reason) and Not requested.
- **My Library, Series cards:** Follow button, status counts, "Show every book" and "Add missing books".
- **Book-type follow filters:** comics and graphic novels, plays and screenplays, companions (diaries,
  calendars, maps, games, art and quiz books) and non-fiction.
- **Settings, Automation:** defaults for new follows and the default media for missing books. It is also an
  onboarding step.

### Changed
- **Renamed to Storyarr,** with a new icon and favicon. The README credits Dewarr by logabell.
- **Settings, Sources:** the Reading group and Reading accounts are now called Sources.
- **Headings and wording:** "My library" in sentence case, one main heading per page, British spellings, and no
  contractions.
- **In-app help links** for OpenID Connect and Plex now open Storyarr's own guides.
- **Activity in three tabs, each with filter buttons:**
  - **Queue (was Active and Downloading):** All, Downloading, and Needs review (admins). Needs review replaces the
    old Download review tab.
  - **Wanted (was Pending):** All, and Your requests (for people who approve requests).
  - **History:** All, In library, Declined, and Withdrawn.
  - Old links open the matching tab and filter.
- **Square corners across the app:** buttons, chips, cards, inputs, dialogs, tabs, and covers. Loading
  spinners, status dots, and people's avatars stay round.
- **Settings in six groups:** General, Accounts, Reading, Library, Downloads, and System. Each group has its
  own section tabs. In Shelf the groups are the header sub-menu with icons. In Classic they sit above the
  section tabs.
- **Defaults for new follows:** new follows use your saved defaults when no filters are given.
- **Select every missing book:** list automation can select every missing book in one step; hand-picked
  selection keeps its 25-book limit.

### Removed
- **Main menu:** the request count badge is removed.

### Fixed
- **Slow request counts (database speed, part 1):**
  - The counts behind Activity took about 4 minutes on a large library. They now take under a second, thanks to two
    new indexes on the operations table.
  - Postgres no longer compiles Storyarr's queries to machine code (JIT), which cost more than it saved.
- **Leaving a page stops its database work:** the server cancels a page's database query when the browser
  moves away.
- **Onboarding failed after the Automation step:** saving failed with an error from the server, because it
  only accepted the original seven steps. It now accepts all nine.
- **Removed files in My Library:** My Library no longer lists files that were removed or are confirmed missing as
  unticked books.

[Unreleased]: https://github.com/TheMightyTRex/storyarr/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/TheMightyTRex/storyarr/compare/v0.5.9...v0.6.0
[0.5.9]: https://github.com/TheMightyTRex/storyarr/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.8...v0.5.8
[0.4.8]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/TheMightyTRex/storyarr/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/TheMightyTRex/storyarr/compare/v0.3.9...v0.4.0
