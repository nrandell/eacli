# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
