# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-05-22

### Fixed

- **list_bookings for multi-member recurring classes** — Fixed incorrect attribution when the Manage Bookings grid only surfaces one household member for future instances of recurring Group Exercise classes (the original "single `member` + incomplete `members[]`" bug). The root causes were:
  - Brittle row selector in `parseManageBookings` that missed rows using non-standard classes or column layouts.
  - Deduplication logic (in both the collector and cross-context merging) that used `cancelQaId` as the primary key. Recurring bookings often share the same cancel ID / ActivityID across linked members, causing the second person's row to be dropped.
- **Robust collection strategy**:
  - `parseManageBookings` is now significantly more tolerant (any row containing a valid cancel link inside the gvBookings table).
  - New `collectManageBookingRows` follows GridView pagination.
  - `getBookings` now explicitly switches to each linked member and collects the full (paged) Manage Bookings view in that context before merging. This guarantees correct `members[]` arrays even when the grid content is member-context dependent or uses shared identifiers for recurring series.
- The final output shape (`members` array + optional legacy `member` for singles) is unchanged.

### Changed

- Bumped version to 1.2.1.

## [1.2.0] - 2026-05-21

### Fixed

- **Multi-member MCP booking** — `book_class` for a second linked member no longer fails due to unreliable member switching, redundant slider clicks on the QuickBook path, or Chromium processes left open after Playwright errors (fixes [#1](https://github.com/nrandell/eacli/issues/1)).
- **Member switch verification** — `switchMember` skips the slider when the target is already selected, polls until the portal confirms selection, and waits for QuickBook to reload.
- **Browser cleanup** — MCP and CLI always close Playwright in a `finally` block, even when booking fails.

### Added

- Error codes `TIMEOUT` and `MEMBER_SWITCH_FAILED` for clearer agent handling.
- Unit tests and HTML fixtures for linked member parsing (`test/members.test.ts`).
- Hermes guide section for multi-member cron jobs.

## [1.1.0] - 2026-05-19

### Fixed

- **Multi-member booking attribution** — `list_bookings` / `bookings list` no longer reports both linked members on every class. The upcoming panel on member home often shows the same household list for each slider position; deduping by session and merging names caused false “both booked” results for agents (e.g. Hermes).

### Changed

- **Bookings source** — List bookings from **Manage Bookings** (`mrmViewMyBookings.aspx`), matching cancel flow, with an explicit member column per row.
- **JSON shape** — Each session includes a `members` array (who is booked). `member` is set only when exactly one person is on that class.
- **CLI output** — Bookings table shows a **Members** column when attribution is available.
- **MCP / agent docs** — Tool descriptions, server instructions, Hermes guide, and eacli skill updated to use `members` per session.

### Added

- Unit tests and HTML fixtures for Manage Bookings parsing and session grouping (`npm test`).

## [1.0.0] - 2026-05-19

### Added

- Initial release: CLI and MCP server for Everyone Active gym bookings (login, members, availability, book, cancel, favourites, doctor).
