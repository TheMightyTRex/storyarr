# Download clients

Settings → Download clients (and the Download clients step of the setup wizard) supports qBittorrent,
Transmission and Deluge for torrents, SABnzbd and NZBGet for Usenet, and slskd for Soulseek. Save and test a connection, map its download folder to a
folder the worker can read. Torrent and Usenet sources use their respective default
client; Soulseek uses slskd. A sole enabled client of a type is the automatic default.

slskd needs an API key with the **administrator** role. slskd only shares its download folder with
administrator keys, and Storyarr needs that folder to import finished downloads. A read-write key passes the
first checks and then fails with "slskd only shares its download folder with an administrator API key". In
slskd's `slskd.yml`:

```yaml
web:
  authentication:
    api_keys:
      storyarr:
        key: <a long random key>
        role: administrator
        cidr: 192.168.0.0/16
```
With multiple clients of the same type, choose the default in Settings → Download clients.

To disable any client, choose **Edit downloader**, clear **Enabled**, and save.
Storyarr retains its address, credentials, category, and folder mappings, but excludes
it from new download choices and stops queued transfers from being submitted.
Transfers already submitted continue to be monitored and imported using their existing
approvals, including approved qBittorrent seeding renames. Disabling Soulseek also stops
new Soulseek searches. Check **Enabled** and save to use the client again; Storyarr tests
the saved connection. Changes to credentials, paths, or import approvals still require
the usual verification before existing transfers can continue.

Download clients do not supply search results. For qBittorrent, configure torrent
sources in Prowlarr (or connect a supported native torrent source). Replacing
SABnzbd with qBittorrent leaves Prowlarr's indexers unchanged, and NZB releases
still require a Usenet client. The book's Sources page reports how many torrent
and Usenet indexers were selected. If no torrent indexers qualify, check that they
are enabled, support search and book/audiobook categories, and are not excluded
in Storyarr's Prowlarr settings. Native MAM handles its own indexer when enabled.

Settings → Libraries selects the final ebook and audiobook folders. These folders are
shared destinations, independent of which client downloaded the content. Saving and
verifying a library folder checks every ready client's download path and does not change
client defaults. Each path must support safe hardlinking or copying into the library.
If one path fails, its named error is shown while other verified paths remain usable.
Successful connection tests and saved download-folder mappings automatically queue checks
for missing or outdated library routes. Settings → Libraries shows each client's path,
verification result, and last successful check. **Verify again** remains available and
rechecks the saved folders directly, without reopening setup or changing import preferences.
A connected client is not marked as library-ready until its folder check succeeds.
Completed downloads are inspected, then hardlinked or copied into the selected media folder;
the client's download folder remains separate.

| Capability | qBittorrent | Transmission | Deluge Web UI |
| --- | --- | --- | --- |
| Versions | 5.x | 3.0+ / 4.x legacy RPC | Connected Deluge daemon |
| Credentials | Web UI username/password | RPC username/password | Web UI password |
| Categories | Native categories | Labels | Existing Label plugin label |
| Attempt identity | Tag + full hashes + path | Label + v1 hash + path | Unique artifact folder + v1 hash + path |
| In-client seeding rename | Supported when enabled | Unavailable in Storyarr | Unavailable in Storyarr |
| Sequential/first-last controls | Not exposed by Storyarr | Unavailable | Unavailable |
| Magnet metadata inspection | 5.2+ | Separate resolver required | Separate resolver required |

Transmission performs the session-id handshake without retrying uncertain submissions.
Deluge must already be connected to its daemon through its Web UI. If a category is
selected, enable Label and create that label in Deluge first. Storyarr reads the label's
completed folder (or daemon defaults) and submits into an isolated `dewarr-<artifact ID>`
subfolder there. Move-completed and automatic management are disabled only for these
new transfers. Existing transfers and global client settings are never rewritten.
The isolated folder also keeps grouped selections for one artifact on the same route.

The new adapters support torrent-file and magnet submission and pause/resume. The
planner currently requires inspectable torrent metadata; a source offering only a
magnet still needs the existing metadata resolver. Full v2 identity verification is
not implemented for these clients, so the planner explicitly refuses v2/hybrid
artifacts instead of dropping a hash claim. Use copy/hardlink destinations with
Transmission and Deluge; seeding-copy rename remains qBittorrent-only.

A durable external-may-exist marker is committed before add. Following a worker crash
or lost response, the worker only observes the recorded transfer and never adds again.
A pre-existing hash, mismatched folder/category, or ambiguous result is held for review.
A Deluge crash before labeling/resuming may therefore leave a paused transfer requiring
review; it does not cause another add. Completed client files still require inspection,
import, and library confirmation before a request is fulfilled.

Adapters are covered by mocked RPC contract tests and database-backed worker lifecycle
tests. These tests do not certify a particular live server installation.

Protocol references: [Transmission RPC](https://github.com/transmission/transmission/blob/4.0.6/docs/rpc-spec.md),
[Deluge Web API](https://deluge.readthedocs.io/en/latest/reference/webapi.html), and
[Deluge core API](https://deluge.readthedocs.io/en/latest/reference/api.html).

## Usenet: SABnzbd and NZBGet

NZB releases from Prowlarr need a Usenet client. Connect one in Settings → Download clients, or in the
Download clients step of the setup wizard.

**SABnzbd**
1. Choose **Connect SABnzbd**.
2. Enter the address Storyarr can reach, for example `http://sabnzbd:8080`.
3. Paste the **API key** from SABnzbd's Config → General.
4. Enter the **category** Storyarr should use (for example `books`). Create that category in SABnzbd first
   (Config → Categories) and give it its own folder.
5. Save, then test. Map SABnzbd's download folder to the folder the Storyarr worker can read.

**NZBGet**
1. Choose **Connect NZBGet**.
2. Enter the address Storyarr can reach, for example `http://nzbget:6789`.
3. Enter the **username** and **password** from NZBGet's Settings → Security (`ControlUsername` and
   `ControlPassword`). A restricted user (`RestrictedUsername`) also works if it may add and read downloads.
4. Enter the **category** Storyarr should use. Create it first in NZBGet's Settings → Categories, with its own
   destination folder.
5. Save, then test. Testing reads the category folder. Map NZBGet's download folder to the folder the
   Storyarr worker can read.

With both connected, choose which one is the default for Usenet. A client that is the only enabled one of its
type is the default automatically.

## Libraries on Unraid user shares or mergerfs

Imports work when the library is an Unraid user share with a cache pool, or a mergerfs pool. These
filesystems can report a new identity for the library folder after the first file is written, which used to
stop imports with "Destination mount changed before publication"
([Dewarr #61](https://github.com/logabell/dewarr/issues/61)). Storyarr places a small hidden file,
`.book-search-root`, in each library folder and recognises the folder by it. Leave that file in place; it holds
no personal data. An import planned before this fix may still be held: use **Cancel import**, then import
again. Details are in [storage compatibility](STORAGE-COMPATIBILITY.md).
