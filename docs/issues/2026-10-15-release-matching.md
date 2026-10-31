# Release matching and review investigation

Scope: [Storyarr: Release matching and review](https://linear.app/northernlogic/project/dewarr-release-matching-and-review-7dee1b88da14), based on `371ed7c` (2026-10-15). The earlier NOR-87 fix is already merged in #69. This work extends its shared series-label contract and checks its review/import safeguards.

## Confirmed defects and fixes

| Issue | Cause | Result |
| --- | --- | --- |
| [NOR-95 / #62](https://github.com/logabell/dewarr/issues/62) | Series notes removed Arabic digits but left Roman numerals as unmatched text. | Canonical Roman positions match an equal catalog position after recognizing the series name. Wrong positions, malformed numerals and ranges remain rejected. |
| [NOR-97 / #64](https://github.com/logabell/dewarr/issues/64) | The parser recognized series suffixes, but not a series/position prefix before the full book title. The first hyphen could also belong to that prefix. | Both reported title layouts retain the full catalog title and exact author credit, with a known series and matching position required. |
| [NOR-99 / #66](https://github.com/logabell/dewarr/issues/66) | Trailing-label parsing omitted `ebook` and supported only uppercase release groups after audio extensions. | The exact reported dotted retail EPUB release identifies its author/title. Content warnings and actual-file format checks remain separate. |
| [NOR-89 / #56](https://github.com/logabell/dewarr/issues/56), supported EPUB case | Inspection rejected any `META-INF/encryption.xml` before inspecting its algorithm or resources. | Only IDPF font obfuscation of local, declared, non-spine font resources is permitted. Unknown encryption, encrypted chapters, path escapes and ambiguous declarations remain held. |

The reported release names failed a regression check before the parser changes. A synthetic EPUB with standard font-obfuscation metadata likewise failed inspection before the EPUB fix. The synthetic font bytes are a parser fixture, not a test of font rendering or deobfuscation; Storyarr neither renders nor rewrites them.

## Unresolved report details

NOR-89 remains open. Its actual EPUB algorithm/resource list is unavailable, so the supported-font fix is not confirmation of the reporter's file. Adobe/other font-obfuscation algorithms remain unsupported.

The controlled administrator flow withdraws a request, requests it again, completes selection, and records exactly one new download. Existing source and download review screens expose the expected actions in the tested states. This does not reproduce the reporter's missing actions or establish their user role, request history, or deployment version. No blanket approval action or request-state workaround was added. Logan authorized continuing without newer reproduction details.

## Validation

All checks use the repository's serial, bounded `python3 scripts/check.py` runner and synthetic media. API/worker journeys use a disposable PostgreSQL database; external indexer/downloader/library calls use fixtures. No live reporter deployment or external download was exercised.

- 316 focused unit/boundary checks: release names, existing release profiles, series-download identity, automatic eligibility, EPUB encryption, and download inspection.
- 31 API/worker journeys: clicked Prowlarr/SABnzbd release names, withdraw/re-request, original-byte-preserving font-obfuscated EPUB import, series file review/confirmation/replay, and automatic series imports.
- 16 browser checks with fixture API responses: source selection, collection review, download matching, and unreadable-file reinspection. Production frontend build passed.
- 23 further API/worker checks passed after advancing the matching-rule revision: the 21 series-review cases above plus two saved-inspection retry cases. A prior font-encryption hold is re-inspected without submitting another download (33 distinct API/worker cases in total).
- Ruff lint/format and diff whitespace checks pass.

Focused commands:

```sh
python3 scripts/check.py unit tests/unit/test_release_name_identity.py tests/unit/test_release_profiles.py tests/unit/test_series_download_identity.py tests/unit/test_automatic_eligibility.py tests/unit/test_epub_encryption.py tests/unit/test_download_inspection.py
python3 scripts/check.py backend tests/integration/test_sabnzbd.py::test_clicked_usenet_release_with_catalog_labels_reaches_downloader tests/integration/test_quick_add.py::test_withdraw_then_request_again_starts_one_new_download 'tests/integration/test_single_file_acquisition.py::test_single_epub_download_to_confirmed_library_keeps_neighbor_private[automatic-obfuscated-font-]' tests/integration/test_series_file_review.py tests/integration/test_series_file_import.py
python3 scripts/check.py backend tests/integration/test_automatic_imports.py::test_retry_reinspects_unreadable_book_without_redownloading tests/integration/test_series_file_review.py
python3 scripts/check.py ui quick-add-sources.spec.ts download-matching.spec.ts collection-review.spec.ts download-inspection-errors.spec.ts
```

See [automatic book matching](../AUTOMATIC-BOOK-MATCHING.md) for user-facing retry instructions. This change does not mark NOR-89 resolved or repeat NOR-87's already-shipped implementation.
