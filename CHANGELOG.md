# Storyarr changelog

Changes in Storyarr, newest first. Storyarr is a fork of [Dewarr](https://github.com/logabell/dewarr) v0.3.9 by
logabell. Release notes for each version are in [docs/releases](docs/releases).

## Unreleased

### Changed
- **Release notes window:** one line says which version you have and which is available, with View on GitHub
  beside it; the release is headed by its version and date only; earlier releases moved to Settings.
- **How to upgrade:** when a newer version is out, the release notes show the steps and the commands to copy, and
  **Upgrade now** when `BOOK_UPGRADE_URL` points to your own upgrade page.
- **Releases in Settings:** System, Upgrades and backups, Releases lists every release in a fold, newest first,
  marking the current version (open) and any newer one.

### Fixed
- Release dates show in British style (1 Nov 2026) whatever the browser's language.

## v0.4.8 (1 November 2026)

### Changed
- **Library tabs, one toolbar (design D):** In my libraries, Authors, Series and All saved titles share one section
  header and toolbar: the tab's heading and count, the view switch, search, format chips, the Library filter,
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
  The Display panel's Low-vision font switch is removed.
- **Slide-out panels** (My library summary, the bookshelf drawer, the calendar day) share one header: the name in
  bold on a white bar with a grey line, and the close button.

## v0.4.7 (1 November 2026)

### Fixed
- **Soulseek (slskd) connection with a read-write API key** ([#1](https://github.com/TheMightyTRex/storyarr/issues/1)):
  slskd 0.26 shares its download folder only with administrator keys, so the test failed with a misleading
  "use a read-write key" message. Storyarr now checks the key before the Soulseek session and says to give the
  key the administrator role. The settings page and the download clients guide say the same.

## v0.4.6 (1 November 2026)

### Changed
- **Storyarr everywhere:** notifications are titled "Storyarr notification", including stored ones
  (migration `storyarr_0086_notification_title`; undo with
  `python -m app.downgrade storyarr_0085_user_preferences`). The default `DB_NAME` and `DB_USER` are `storyarr`,
  and the package, logger, sample compose overrides, CI images and the Docker and development guides use
  Storyarr names. The `x-dewarr-proxy-token` header and the `dewarr-` download folder prefix keep their names.

- **My library summary:** the author and series names open their pages, and a click outside the panel closes it
  (the close button and Escape still work).
- `compose.yaml` names the containers `storyarr` and `storyarr-postgres`, matching the `docker run` guide.
- `scripts/storyarr_rename.py --apply` also restores the lowercase names Storyarr changed, after a Dewarr merge.

### Fixed
- `deploy/compose.build.yaml` and `deploy/compose.dev.yaml` named a `dewarr` service and Dewarr's image and
  release feed, so they did not apply to `compose.yaml`.

## v0.4.5 (1 November 2026)

### Changed
- **My library bookshelf:** a compact cover wall. Clicking a book slides out a summary from the right: cover,
  author, series, formats you have, rating, published, narrator, length and description, with Open book page.
  Covers no longer show Quick add or the in-library tick; getting a missing format is in the summary.
- Source searches keep the loading bar under the header on while they run (book Sources, Quick add,
  Settings, Sources).

### Fixed
- Connection repair accepts a library that switched from hardlink to copy after the download was chosen, so
  held downloads no longer stop at "The library destination changed".

## v0.4.4 (31 October 2026)

### Added
- **Sort by** on Series, Authors and Following: Newest, Number of books, Date published, Author (by surname)
  or A to Z, with Reverse order.
- **Download releases Storyarr could not confirm:** Review release lets an administrator confirm the title and
  author, or an unstated language, before downloading. Recorded in the audit log as
  `acquisition.release-override`.
- **Download unconfirmed releases** permission, for people who are not administrators.
- **Review sources on Requests:** the request's status and the book's sources in a dialog.

### Changed
- Release names crediting every co-author now match the book; "Series by" and "books 1 to 5" names are
  collections.
- Series group together when names differ only in punctuation, a leading "The" or a trailing "Series".
- Followed series and authors in My library open on In library.

## v0.4.3 (31 October 2026)

### Changed
- **Series, Authors and Following layouts:** List and detail (the default) or List, with the switch next to the
  search. The choice is saved with each person's account. Covers, the author's picture beside the name,
  progress, statuses and actions sit in the same place on every row. Following shows the chosen follow's
  bookshelf beside the list. Migration `storyarr_0085_user_preferences`; undo with
  `python -m app.downgrade storyarr_0084_background_work`.

## v0.4.2 (31 October 2026)

### Added
- **Background work** (Settings → System): choose how often scheduled jobs run: Normal, Relaxed (×5), Light
  (×20) or Minimal (×50). Normal keeps the usual schedule; a change applies within a minute. The upgrade wizard
  offers it as a new setting. Migration `storyarr_0084_background_work`; undo with
  `python -m app.downgrade 0083_operation_lookups`.

## v0.4.1 (31 October 2026)

### Fixed
- **Release notes window:** left-aligned in the Shelf layout, with bold section headings. Long list items stay
  together, numbered lists work, and the release title is not repeated.

## v0.4.0 (31 October 2026): the first Storyarr release

### Published
- **Docker image** for amd64 and arm64 at `ghcr.io/themightytrex/storyarr`: `latest` for releases, `vX.Y.Z` to
  pin one, `edge` for the newest checked build. Built and checked by GitHub Actions.
- **Guides:** installing, setting up, updating, moving from Dewarr, and releasing (for maintainers).
- **New screenshots** with invented books and generated covers.

### Added
- **Going back to an earlier release:** `docker exec storyarr python -m app.downgrade <revision>` moves the database
  back, for example to Dewarr v0.3.9 (`0080_member_setup`). Tested both ways.
- **Upgrade wizard title** shows the version number, such as "Welcome to version 0.4.0".
- **Browser tabs:** each tab is named after its page.
- **Calendar Show menu:** covers on the calendar, and which sources and authors appear. Saved in each browser.
- **Bookshelf drawer:** Search now, and Exclude from this follow (or Include again).
- **Loading bar:** a thin bar under the header while a page is fetching data.
- **Upgrade wizard (F):**
  - Before an existing install upgrades, Dewarr saves a settings backup to `/config/upgrade-backups`.
  - Admins then get a wizard: what is new, the backup to download, new settings to review, and the way back
    (restore settings from a backup; your current settings are saved first).
  - New installs get onboarding instead.
  - Also in Settings → System → Upgrades and backups.
  - **Automatic upgrades:**
    - "Keep the defaults and finish" in the wizard.
    - An "Upgrade automatically" setting (or `BOOK_UPGRADE_AUTOMATIC=true`), so startup backs up and keeps
      the defaults.
    - `POST /api/upgrade/automatic` for scripts.
  - The title names the version, and new settings open in place.
- **Audible matching (E):** when matching a library audiobook, **Search Audible** lists recordings with narrator,
  length, series, year, and ASIN. A "Narrator matches" tag marks recordings read by the same narrator. Choosing
  one adds it to the catalog and matches it.
- **Audible store setting:** Settings → Reading → Metadata → Audible store (United States, United Kingdom, and
  eight others). It is suggested from your browser's country.
- **Search again for wanted books (D):**
  - When a quick-add search finds no suitable release, the book is now searched again automatically: after 6
    hours, then daily for a week, then weekly. Before, this only happened for books with a known release day.
  - Older wanted requests were added too.
  - *Setting:* Settings → Automation → Wanted books (on, for audiobooks and ebooks), also in onboarding.
  - Followed books show the next automatic search time instead of "not searched automatically".
- **Header sub-menus (Shelf layout):** each section's sub-menu is a second row of the fixed header, with icons
  and square corners.
  - *Library:* My library, Following, and Library review.
  - *Discover:* For you, Your series, Browse, Calendar, Collections, Awards, and Your lists.
  - *Activity:* the request filters, with counts.
  - The current page has a bar under it. Classic keeps the tabs inside each page.
- **Bookshelf page for each follow (redesign step 3):** "Open bookshelf" on Following and on library series cards.
  - *Header:* the series or author, a progress bar of released books in your library, and excluded and
    not-yet-released counts. It also has Add missing books, Manage follow, and a link to the series or author
    page.
  - *Cover wall:* every book has a status chip, and status filter chips sit above. Excluded books are faded.
  - *Side drawer:* selecting a cover shows the book's status and detail, with Open book page and, where it
    applies, Open in Activity. Escape closes it.
- **Light theme (redesign step 2), now the default:** every page has a light theme. Dark and Match device are
  options, and dark keeps the original look.
- **Display and accessibility settings:** a Display button at the far right of the header, Settings → General,
  and the onboarding "Layout and display" step. Settings are theme, text size (100% to 175%), low-vision font,
  high contrast, reduce motion, underline links, and wider text spacing, plus Reset. Choices are saved in each
  browser.
- **Fixed header:** the search header stays at the top of every page while you scroll, with Display always at
  its far right. On phones, header buttons show icons only.
- **Layout setting (redesign step 1):** Settings → General and a new onboarding step offer Classic or Shelf.
  - *Classic (default):* the original menu.
  - *Shelf:* a slim icon menu with Library, Discover, Activity, and Settings. My library, Following and Library
    review are tabs inside Library. On phones the menu is a bar along the bottom.
  - The choice is saved in each browser.
- **Delete library books** (admin): Delete in the book overview's actions and on each library copy (book page
  and My Library). The pop-up warns what is removed, how to recover it, and what blocking does; afterwards it
  shows the recovery steps with exact paths.
  - *Default:* moves the files to a hidden holding folder in the library and removes the book from
    Audiobookshelf.
  - *Delete permanently:* Audiobookshelf deletes the files, after you type DELETE to confirm.
  - *"Block this book from future downloads" (on by default):* cancels your requests, excludes the book from
    follows and Hardcover lists, and removes it from your lists that download automatically.
- **Deleted-books retention** (Settings → Automation, admins): held books are deleted permanently after this
  many days (default 30; 0 = never), by a nightly job.
- **"Add missing books":** a pop-up on followed authors and series, series and author pages, and library series
  cards. You choose media and book types (from your defaults, or save new ones), and it searches for every
  missing book, with no 25-book limit. Before you start, it lists every book it will search for.
- **Book statuses:** every book in a followed author or series shows one status, with filter chips and counts.
  - The statuses are In library, Downloading %, Importing, Searching, Waiting (with next search time),
    Not released, Needs attention, Wanted, Excluded (with the reason) and Not requested.
- **My Library → Series cards:** Follow button, status counts, "Show every book" and "Add missing books".
- **Book-type follow filters:** comics and graphic novels, plays and screenplays, companions (diaries,
  calendars, maps, games, art and quiz books) and non-fiction.
- **Settings → Automation:** defaults for new follows and the default media for missing books. It is also an
  onboarding step.

### Changed
- **Renamed to Storyarr,** with a new icon and favicon. The README credits Dewarr by logabell.
- **Settings, Sources:** the Reading group and Reading accounts are now called Sources.
- **Headings and wording:** "My library" in sentence case, one main heading per page, British spellings, and no
  contractions.
- **In-app help links** for OpenID Connect and Plex now open Storyarr's own guides.
- **Main menu:** the request count badge is removed.
- **Activity in three tabs, each with filter buttons:**
  - *Queue* (was Active and Downloading): All, Downloading, and Needs review (admins). Needs review replaces the
    old Download review tab.
  - *Wanted* (was Pending): All, and Your requests (for people who approve requests).
  - *History:* All, In library, Declined, and Withdrawn.
  - Old links open the matching tab and filter.
- **Square corners across the app:** buttons, chips, cards, inputs, dialogs, tabs, and covers. Loading
  spinners, status dots, and people's avatars stay round.
- **Settings in six groups:** General, Accounts, Reading, Library, Downloads, and System. Each group has its
  own section tabs. In Shelf the groups are the header sub-menu with icons. In Classic they sit above the
  section tabs.
- New follows use your saved defaults when no filters are given.
- List automation can select every missing book in one step; hand-picked selection keeps its 25-book limit.

### Fixed
- **Slow request counts (database speed, part 1):**
  - The counts behind Activity took about 4 minutes on a large library. They now take under a second, thanks to two
    new indexes on the operations table.
  - Postgres no longer compiles Dewarr's queries to machine code (JIT), which cost more than it saved.
- **Leaving a page stops its database work:** the server cancels a page's database query when the browser
  moves away.
- **Onboarding failed after the Automation step:** saving failed with an error from the server, because it
  only accepted the original seven steps. It now accepts all nine.
- My Library no longer lists files that were removed or are confirmed missing as unticked books.
