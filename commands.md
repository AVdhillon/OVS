# OVS — Run Commands

Project has two parts:
- `backend/` — NestJS API + Prisma (PostgreSQL)
- `frontend/` — Vite + React app

Prerequisites: Node.js installed, and a running PostgreSQL database (local or hosted, e.g. Supabase/Neon/Docker).

---

## 1. Backend setup

```bash
cd backend
npm install
```

Create a `.env` file in `backend/` (none is included in the zip) with at least:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME"
JWT_SECRET="some-long-random-string"
ALLOWED_ORIGINS="http://localhost:5173"
PORT=3000
NODE_ENV=development

# Optional — only needed if you use these features
VOTER_HASH_SALT="another-random-string"
OTP_DEVMODE=true
SENDGRID_API_KEY=
SENDGRID_SENDER_EMAIL=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
TWILIO_COUNTRY_CODE=
DISABLE_CRONS=false
```

Generate the Prisma client and push the schema to your database (no migration files are included, so use `db push` for a fresh setup):

```bash
npx prisma generate
npx prisma db push
```

Run the backend:

```bash
# development (watch mode)
npm run start:dev

# or plain start
npm run start
```

By default it runs on `http://localhost:3000` (or whatever `PORT` you set). Swagger docs are available at `http://localhost:3000/api-docs` when `NODE_ENV` is not `production`.

---

## 2. Frontend setup

Open a **second terminal**:

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/` with:

```
VITE_API_URL=http://localhost:3000
```

Run the frontend:

```bash
npm run dev
```

This starts the Vite dev server (default `http://localhost:5173`).

---

## 3. Quick reference

| Task                    | Command (run inside `backend/` or `frontend/`) |
|--------------------------|------------------------------------------------|
| Install deps             | `npm install`                                   |
| Backend dev server       | `npm run start:dev` (backend)                   |
| Frontend dev server      | `npm run dev` (frontend)                        |
| Backend prod build       | `npm run build` then `npm run start:prod`       |
| Frontend prod build      | `npm run build`                                 |
| Prisma client generate   | `npx prisma generate` (backend)                 |
| Push DB schema           | `npx prisma db push` (backend)                  |
| Backend tests            | `npm run test` / `npm run test:e2e`             |

---

## Notes
- No `.env` files were bundled in either zip — you must create them yourself as shown above (at minimum `DATABASE_URL`, `JWT_SECRET` for backend and `VITE_API_URL` for frontend).
- `bullmq` / `ioredis` are listed as backend dependencies but aren't wired into any module, so **Redis is not required** to run the app.
- There's no `prisma/migrations` folder in the project, so `prisma migrate dev` won't work out of the box — use `prisma db push` instead (or generate your own initial migration with `npx prisma migrate dev --name init`).
- Run backend and frontend in separate terminals; the frontend expects the backend reachable at `VITE_API_URL`.
