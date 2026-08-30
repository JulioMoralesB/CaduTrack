# CaduTrack 🥦 [WIP]

A food expiry tracker app to register purchased food items, their expiration dates, and receive alerts before they expire — so nothing goes to waste.

---

## Features

- 📦 Register food items with name, category, quantity, unit, and storage location
- 📅 Track expiration dates with automatic status calculation (fresh / expiring soon / expired)
- 🔔 Alerts before items expire
- 📱 Progressive Web App (PWA) — installable on mobile devices
- 🗂️ Filter by storage location: fridge, freezer, or pantry

---

## Tech Stack

| Layer      | Technology                              |
|------------|-----------------------------------------|
| Frontend   | React + Vite + TypeScript (PWA enabled) |
| Backend    | FastAPI + SQLAlchemy + PostgreSQL       |
| Migrations | Alembic (schema-per-service)            |
| Alerts     | APScheduler + Telegram Bot API          |
| Hosting    | Home server via Cloudflare Tunnel       |

---

## Where this runs

CaduTrack is deployed on a home server whose architecture — the shared PostgreSQL
instance, the Docker network, how logs are collected, how services are exposed —
is documented in one place:

**[server-documentation.apollox10.com](https://server-documentation.apollox10.com)**

Read it before changing anything infrastructure-shaped: logging, deployment,
networking or the database. Those decisions live there, not here, and this
repository does not find out when one of them changes. It has already happened:
the logging setup in this repo was built around a collector that had been retired
weeks earlier, because the repo still described it.

---

## Repository Structure

```
cadutrack/
├── frontend/       # React + Vite + TypeScript PWA
└── backend/        # FastAPI + PostgreSQL + APScheduler
```

---

## Database Schema

### `categories`
| Column     | Type      |
|------------|-----------|
| id         | serial PK |
| name       | text      |
| created_at | timestamp |

### `products`
| Column     | Type                              |
|------------|-----------------------------------|
| id         | serial PK                         |
| name       | text                              |
| category_id| integer FK → categories           |
| quantity   | numeric                           |
| unit       | text                              |
| expires_at | date                              |
| location   | text (`fridge`, `freezer`, `pantry`) |
| notes      | text                              |
| created_at | timestamp                         |
| updated_at | timestamp                         |

> CaduTrack owns the database `cadutrack` and the schema `cadutrack` inside the
> shared `apollo-server-db` PostgreSQL instance. It does not run its own database
> server. Alembic's version table lives in `public`.

### Expiry Status Logic

| Status          | Condition                  |
|-----------------|----------------------------|
| `fresh`         | `days_until_expiry > 7`    |
| `expiring_soon` | `days_until_expiry` 0–7    |
| `expired`       | `days_until_expiry < 0`    |

A product expiring **today** counts as `expiring_soon`, not `expired` — it is
still edible, and the point is to prompt the user to use it. "Today" is
evaluated in `TIMEZONE`, not the host's local zone.

---

## Development Roadmap

| Phase   | Scope                        | Issues   |
|---------|------------------------------|----------|
| Phase 0 | Foundation                   | #1–#3, #38 |
| Phase 1 | Backend Core                 | #8–#13   |
| Phase 2 | Frontend                     | #14–#19  |
| Phase 3 | Telegram Alerts              | #20–#23  |
| Phase 4 | PWA & Deployment             | #24–#29, #37 |
| Phase 5 | Enhancements / Backlog       | #30–#33, #36 |

---

## Development Workflow

This project follows a **branch-per-issue** strategy:

```
<type>-<issue-number>/<short-description>
```

**Examples:**
```
feat-8/database-migrations
feat-15/product-list-ui
fix-21/expiry-alert-timezone
```

Steps for each issue:
1. Create branch from `main`
2. Implement changes
3. Open a Pull Request referencing the issue
4. Merge after review

---

## Getting Started

> Prerequisites: Python 3.11+, Node.js 20+, PostgreSQL 15+, Docker (optional)

### Backend

```bash
cd backend
python -m venv env
source env/bin/activate
pip install -r requirements-dev.txt
```

Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your database URL, Telegram bot token, etc.
```

Create the database, run migrations and seed the default categories:

```bash
python -m app.db.bootstrap   # creates the database if it does not exist
alembic upgrade head
python -m app.seed
```

All three are idempotent and run automatically on container start, so this is
only needed when running the API directly on the host.

> **Running the tests wipes the database they point at.** The integration tests
> `TRUNCATE` products and categories, so they refuse to run unless `DB_NAME`
> ends in `_test`:
>
> ```bash
> DB_NAME=cadutrack_test pytest
> ```

Start the server:

```bash
uvicorn app.main:app --reload --port 8001
```

> Port 8001, not the FastAPI default: `free-games-notifier` already publishes
> 8000 on the host.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Environment Variables

There are two `.env.example` files, and they are not interchangeable:

| File | Use it for |
|------|------------|
| [`.env.example`](.env.example) (repo root) | **Deploying** with `compose.yaml` — Dockge or `docker compose up -d` |
| [`backend/.env.example`](backend/.env.example) | Running the API **directly on your machine**, without Docker |

The root file omits `DB_HOST` on purpose: `compose.yaml` points the container at
`apollo-server-db` over the shared network. The backend file sets it to
`localhost`, which is correct on your machine and wrong inside a container — so
do not copy that one to the root.

See [`backend/.env.example`](backend/.env.example) for the full documented list
of settings; every one of them is valid in either file.

| Variable              | Description                                        |
|-----------------------|----------------------------------------------------|
| `DB_HOST` / `DB_PORT` | Shared `apollo-server-db` host and port            |
| `DB_NAME`             | Database owned by this service (`cadutrack`)       |
| `DB_USER` / `DB_PASSWORD` | PostgreSQL credentials                         |
| `DB_SCHEMA`           | Schema owned by this service (`cadutrack`)         |
| `API_KEY`             | Protects mutating endpoints via `X-API-Key`        |
| `TELEGRAM_BOT_TOKEN`  | Token from @BotFather                              |
| `TELEGRAM_CHAT_ID`    | Target chat ID for alerts                          |
| `ALERT_DAYS_AHEAD`    | Days before expiry to trigger alert                |
| `TIMEZONE`            | IANA timezone for log timestamps and alert times   |
| `LOG_FILE`            | Rotating JSON log path; empty means stdout only    |

---

## Releases

Docker images are published to GHCR by `.github/workflows/release.yml`, which
runs on version tags only:

```bash
git tag v0.1.0
git push origin v0.1.0
```

That builds and pushes two multi-arch images:

| Image | Contents |
|-------|----------|
| `ghcr.io/juliomoralesb/cadutrack`     | Frontend — the Vite build served by nginx |
| `ghcr.io/juliomoralesb/cadutrack-api` | Backend — FastAPI |

Each tag publishes both `{version}` and `latest`.

Both packages are **public**, inherited from the repository's visibility, so the
server pulls them anonymously — no `docker login` needed, same as
`free-games-notifier` and `apollo-server-dashboard`.

> If the repository is ever made private again, existing packages keep their
> visibility but new ones are created private. In that case either flip each
> package to public in its GHCR settings, or run
> `docker login ghcr.io -u JulioMoralesB` on the server with a token carrying
> `read:packages` — otherwise `docker compose pull` fails with `unauthorized`.

---

## License

MIT