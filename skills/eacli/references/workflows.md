# eacli workflows

## Book

1. `list_members` — multi-profile returns `data.profiles`; single `.env` returns `data.members`.
2. Choose **member** / **profile** (never guess from the class name alone).
3. `check_availability` with **activity** + **date** + member.
4. If `alreadyBooked: true` → stop (or offer cancel first).
5. If no `available` / `waitlist` sessions → report and stop.
6. Confirm with the user: activity, date, time, member.
7. `book_class` with the same activity / date / member.
8. `list_bookings` for that member — look at `members[]` and `status` (`Confirmed` or `Waiting List`).
9. If `book_class` returned `confirmed: false` but the session appears in `list_bookings`, treat as success.

## Availability only

```
check_availability { activity: "hiit", date: "next saturday", member: "hayley" }
```

Do not omit activity (full scans take many minutes and often time out).

## Cancel

1. Optional: `list_bookings` to confirm the session exists.
2. Confirm with user.
3. `cancel_booking` with activity, date, member.

## Login / session repair

```
login { force: true, profile: "nick" }
doctor
```

Run after `NOT_LOGGED_IN`, repeated `NETWORK_ERROR`, or empty activity list failures.

## Multi-profile household

Each person has a **separate EA login** in `.eacli-profiles.json`.  
`list_bookings` only shows the **active profile’s** bookings. Always pass member/profile when booking for someone else.
