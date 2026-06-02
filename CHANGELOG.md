# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-06-02

### Fixed
- **Availability for secondary linked members (Hayley etc.)** — The portal often renders an "You're booking on behalf of ..." `.alert-warning` + empty sessions list when using QuickBook/favourite navigation for a non-primary selected member, even when bookable slots exist (visible via the Make-a-Booking browse path). This interacted badly with day-specific favourites chosen via `findFavourite` for natural-language dates like "next thursday". 
  - `openClassStatus` now broadens its existing "already booked" fallback to also trigger on 0 sessions + "on behalf of" (or "already booked") page messages *when the initial load used the favourite path*. Falls back to browse and surfaces real sessions (banner may still be present for awareness).
  - This makes `check_availability` (with explicit `--member "Full Name"`) reliably return slots for household members regardless of which nav path was preferred.
- **Booking confirmation diagnostics** — `book_class` / `book` now returns additional `confirmationDetails?` (short success/fail text extracted from final page) and `finalUrl?` on the result when available. The final page HTML is *always* saved to `.eacli-session/last-book-result.html` (not just under DEBUG) to aid post-mortems of `confirmed: false` cases (races, text variants, on-behalf flows). Success regex expanded with more common EA phrases ("has been booked", "your booking", etc.). Failure-like text is captured into details for the !confirmed path. CLI print now surfaces the details in the yellow warning.

### Changed
- Docs (SKILL.md, reference.md) + MCP server instructions now explicitly document the "on behalf of" / member-context quirk for secondary members, recommend explicit full member + precise DD/MM/YYYY dates, and reinforce post-`book_class` verification via `list_bookings`.
- Date parameter descriptions (schema + hints) updated to call out reliability preference for explicit dates on household accounts.
- Minor CLI output improvements in empty-availability cases to call out the known quirk when the banner is seen.

## [1.3.0] - 2026-05-22

### Breaking Changes

- **`list_bookings` / `bookings list` output** — The legacy singular `member` field has been **removed entirely**. Responses now only contain the `members` array for every booking, even when only one person is booked on a session. Any code or agents that read the old `member` field must be updated to use `members` instead (which will always be present and will contain one or more names).

### Changed

- Bumped version to 1.3.0 (this release focuses on cleaning up the output shape after the robustness work in 1.2.1).

## [1.2.1] - 2026-05-22

### Fixed

- **list_bookings for multi-member recurring classes** — Fixed incorrect attribution when the Manage Bookings grid only surfaces one household member for future instances of recurring Group Exercise classes (the original "single `member` + incomplete `members[]`" bug). The root causes were:
  - Brittle row selector in `parseManageBookings` that missed rows using non-standard classes or column layouts.
  - Deduplication logic (in both the collector and cross-context merging) that used `cancelQaId` as the primary key. Recurring bookings often share the same cancel ID / ActivityID across linked members, causing the second person's row to be dropped.
- **Robust collection strategy**:
  - `parseManageBookings` is now significantly more tolerant (any row containing a valid cancel link inside the gvBookings table).
  - New `collectManageBookingRows` follows GridView pagination.
  - `getBookings` now explicitly switches to each linked member and collects the full (paged) Manage Bookings view in that context before merging. This guarantees correct `members[]` arrays even when the grid content is member-context dependent or uses shared identifiers for recurring series.

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
