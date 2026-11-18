# Time Tracker: technical notes

This file is for you or your AI when you change the code. For plain-English setup, see the README in the folder above this one.

## Stack

- **Server:** a Cloudflare Worker (`worker/src/index.js`) that holds every `/api/*` route in one big `if` chain. Each route calls a handler in `worker/src/handlers/`.
- **Database:** Cloudflare D1, which is SQLite. `schema.sql` is the base layout, and `migrations/` holds the numbered changes on top of it. `db/d1-setup.sql` is both of those combined into one file for a fresh install. Rebuild it with `npm run schema` after you add a migration.
- **Website:** plain HTML, CSS and JavaScript in `public/`, with no build step. `app.js` is the main app. The `vp-*.js` files are extra screens: weekly board, team week and lock settings. `vp-screens.json` lists which ones load.
- **PDF export:** `worker/src/pdf.js`, built on `pdf-lib`, which is the only runtime dependency.
- **Auth:** email and password (PBKDF2, salted per user) with bearer session tokens. Google sign-in is optional (`worker/src/googleAuth.js`) and stays off until its secrets are set.

## Roles

- **admin:** sees and does everything.
- **manager:** an employee with an extra `staff_roles` row. Manages assignments and hour budgets for their clients.
- **employee:** logs time, but only on clients they are assigned to.
- **client:** a read-only login to a client portal (`/api/client/*`).

## Demo mode

`npm run demo` starts `demo/server.mjs`. It runs the same Worker code, but swaps in local stand-ins for the Cloudflare pieces:

- **Database:** D1 becomes an in-memory `node:sqlite` database.
- **Static files:** they are read from `public/`.

`demo/seed.mjs` then loads the fake data through the app's own API.

## Main API routes (all need `Authorization: Bearer <token>` except auth)

| Area | Routes |
|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/register` (first user: `X-Bootstrap-Secret`; later: admin only), `GET /api/me` |
| Time | `GET/POST /api/time-entries`, `PATCH/DELETE /api/time-entries/:id`, `/api/timer/start|stop|current` |
| Clients | `GET/POST /api/clients`, `PATCH /api/clients/:id`, `GET/POST /api/assignments` |
| Reports | `GET /api/reports/summary`, `GET /api/reports/export` (CSV), `GET /api/reports/staff?format=pdf` |
| Weekly | `GET /api/admin/weekly`, `GET /api/team/weekly`, `GET/PUT /api/admin/lock-schedule`, `POST /api/admin/lock-before` |
| Team | `GET /api/admin/users`, `PATCH /api/admin/users/:id` (role, active, `cost_rate_cents`) |

Money is stored in **cents**, hours as decimals, and dates as `YYYY-MM-DD`. Week boundaries and "today" use **US Eastern time**. Search for `America/New_York` to change it.

## Optional features and their settings

See `.dev.vars.example`. Each feature switches itself off and stays inactive until its settings exist:

| Feature | Settings it needs |
|---|---|
| Brevo email | `BREVO_API_KEY` |
| PayPal invoices | `PAYPAL_*` |
| Google sign-in | all four `GOOGLE_*` values |
| Read-only integration feed | `INTEGRATION_TOKEN` |
| Goals writer | `GOALS_WRITE_TOKEN` |

## Before going live

- Put your own domain in `ALLOWED_ORIGIN_SUFFIXES` (`worker/src/util.js`) if the website and API live on different hosts.
- Delete the `BOOTSTRAP_SECRET` once your first admin exists.
- Have someone review the auth code and the role checks for your setup.
