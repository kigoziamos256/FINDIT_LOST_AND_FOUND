# 🔎 FindIt — Distributed Lost & Found

A fault-tolerant, community-powered lost & found system with automatic background matching.

- **Frontend**: vanilla JS SPA (no build step) with modern CSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (also acts as the durable job queue)
- **Matching worker**: background process that scores lost↔found pairs using pg_trgm text similarity, category, time and location
- **Auth**: short-lived JWT access tokens (15 min) + rotating refresh tokens
- **Deploy target**: Render (one-click `render.yaml`) or Docker Compose locally

---

## 🚀 Deploy to Render (5 minutes)

1. Push this folder to a new GitHub repo (you're already here!).
2. On [render.com](https://render.com) → **New → Blueprint** → connect the repo.
   Render reads `render.yaml`, creates the PostgreSQL database, and deploys the web service automatically.
3. Wait ~3 min. Your URL looks like `https://findit-lost-found.onrender.com`.
4. **First user to register becomes the admin.** Create your account, then create a second account to demo claims.

> ⚠️ On Render's free tier the Postgres instance expires after 90 days and the web service sleeps after 15 min of inactivity. First request after sleep takes ~30 s (this is itself a nice fault-tolerance demo).

---

## 🐳 Local — Docker (recommended for demo video)

```bash
docker compose up --build
# open http://localhost:3000
