# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2026-07-11

### Added

- **Navigation retries** — `safeGoto` retries transient Chromium network failures (`ERR_NETWORK_CHANGED`, connection errors, timeouts) with backoff.
- **`NETWORK_ERROR` code** — Maps `net::ERR_*` failures with a short retry hint for agents.
- **Always-on run logs** — Each CLI/MCP command writes `.eacli-session/logs/<stamp>-<cmd>-<profile>.log` and mirrors to `last-run.log`. Failures also save `last-failure.html` / `last-failure.png`. JSON errors may include `logPath` and `artifacts`.
- **Progress on stderr** — `[eacli] …` phase lines so OpenClaw exec/poll tooling sees activity during long Playwright runs.
- **OpenClaw skill pack** — [skills/eacli/](skills/eacli/) (`SKILL.md` + references) and root [OPENCLAW.md](OPENCLAW.md).
- **Doctor diagnostics** — Reports last-run log, last-failure artifacts, and Playwright version.

### Changed

- Dependency bumps (Playwright, axios, MCP SDK, tsx, etc.; TypeScript stays on 6.x).
- Activity matching strips portal day/time suffixes and accepts spaced queries like `h I I t` when the list loads.
- Empty Group Exercise list throws a diagnostic error (URL/title + failure dump) instead of blank `Examples:`.
- MCP server instructions and activity param docs push compact names (`hiit`) and network retry guidance.
- Cursor skill is a thin pointer to `skills/eacli/`.

### Fixed

- Clearer post-mortems for OpenClaw booking hangs and network flakes that previously surfaced as `UNKNOWN` or empty activity-not-found messages.

## [1.5.0] - 2026-06-23

### Added

- **Multi-profile login (v1.5.0)** — Household members with separate Everyone Active credentials use `.eacli-profiles.json` (see `.eacli-profiles.example.json`). Per-profile sessions in `.eacli-session/auth-<key>.json`. CLI global `--profile`; `--member` auto-selects profile. Commands: `profiles list`, `login --profile <key>`.
- **Self-documenting agent integration** — [AGENTS.md](AGENTS.md) (repo root) and [docs/agents.md](docs/agents.md) as the canonical guide for OpenClaw, Cursor, and other MCP hosts. Cursor skill and Hermes doc now point here.

### Changed

- **`list_members` response (multi-profile)** — When two or more profiles are configured, returns `data.profiles` instead of `data.members`. Single-account `.env` behaviour unchanged (`data.members`). Agents must check which field is present.

### Fixed

- **`book_class` without member** — No longer rejects single-profile `.eacli-profiles.json` setups; only requires `member`/`profile` when `hasMultipleProfiles()`.
- **Profile name matching** — Member resolution uses profile key, full name, or first name only (surname-only queries like `randell` no longer match ambiguously).
- **Post-login verification** — Fails if portal display name cannot be read or does not match the profile (brittle by design).
- **Legacy session drift** — Migrating `.eacli-auth-state.json` copies to `auth-default.json` and deletes the legacy file; saves also remove stale legacy sessions.
- **list_bookings / cancel_booking missing confirmed sessions** — Everyone Active's Manage Bookings page now renders separate `gvBookings` tables per section (e.g. "Bookings on Waiting List" and "Confirmed bookings"). `parseManageBookings` previously read only the first table, so accounts with waitlisted classes saw incomplete lists (often a single session). The parser now iterates all tables; `status` reflects the section (`Confirmed` vs `Waiting List`). `cancel_booking` uses the same paged collector as `list_bookings`.

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
