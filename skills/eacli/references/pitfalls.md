# eacli pitfalls

## NETWORK_ERROR / ERR_NETWORK_CHANGED

Chromium loses the connection when the host network changes (Wi‑Fi, VPN, sleep). eacli **retries** navigations, but hard failures still surface as:

- `error.code`: `NETWORK_ERROR`
- Message mentions `net::ERR_…` and a retry hint

**Agent action:** wait a few seconds → retry the same tool once → if still failing, `login` force + `doctor`, report `error.logPath`.

## Long “silent” runs

Playwright steps take **30–90+ seconds**. Progress is written to **stderr** as `[eacli] …` and to `.eacli-session/last-run.log`.  
Do not kill the process under ~120–180s unless the host timeout requires it. Set MCP timeout **≥ 180s**.

## Activity “h I I t” / H I I T

The portal labels HIIT with spaces: **`H I I T Sat 08:25`**.  
Always pass **`hiit`** (or `combat`, etc.) as the activity query. Spaced forms often still match when the list page loaded; empty “Examples:” usually means the **list page never rendered** (network/session), not a bad name.

## Empty activity list

Error text contains `Activity list was empty` and points at `last-failure.html`.  
Causes: network glitch, wrong page, stale session. Retry → force login → doctor.

## confirmed: false after book

Not always a failure. Portal success text varies. Always **`list_bookings`** for that profile before booking again.

## list_members shape

| Setup | Field |
|-------|--------|
| Multiple profiles | `data.profiles` |
| Single `.env` | `data.members` |

## list_bookings members

Use **`members`** (array) per session — there is no singular `member` field.  
Mention **`status`** when it is `Waiting List`.

## Shell without --json

Agents should always use `--json`. Without it, output is human tables and harder to parse. Quote all multi-word CLI args.
