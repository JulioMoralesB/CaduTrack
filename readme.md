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
| Backend    | FastAPI + PostgreSQL                    |
| Migrations | yoyo-migrations (schema-per-API)        |
| Alerts     | APScheduler + Telegram Bot API          |
| Hosting    | Home server via Cloudflare Tunnel       |

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

### Expiry Status Logic

| Status          | Condition                  |
|-----------------|----------------------------|
| `fresh`         | `days_until_expiry > 7`    |
| `expiring_soon` | `days_until_expiry` 1–7    |
| `expired`       | `days_until_expiry <= 0`   |

---

## Development Roadmap

| Phase   | Scope                        | Issues   |
|---------|------------------------------|----------|
| Phase 0 | Foundation                   | #1–#4    |
| Phase 1 | Backend Core                 | #5–#10   |
| Phase 2 | Frontend                     | #11–#16  |
| Phase 3 | Telegram Alerts              | #17–#20  |
| Phase 4 | PWA & Deployment             | #21–#26  |
| Phase 5 | Enhancements / Backlog       | #27–#30  |

---

## Development Workflow

This project follows a **branch-per-issue** strategy:

```
feature/<issue-number>-<short-description>
```

**Examples:**
```
feature/5-database-migrations
feature/11-product-list-ui
feature/17-telegram-bot-setup
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
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your database URL, Telegram bot token, etc.
```

Run migrations:

```bash
yoyo apply
```

Start the server:

```bash
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Environment Variables

| Variable              | Description                          |
|-----------------------|--------------------------------------|
| `DATABASE_URL`        | PostgreSQL connection string         |
| `TELEGRAM_BOT_TOKEN`  | Token from @BotFather                |
| `TELEGRAM_CHAT_ID`    | Target chat ID for alerts            |
| `ALERT_DAYS_BEFORE`   | Days before expiry to trigger alert  |

---

## License

MIT