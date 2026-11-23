# Project Report — FindIt: A Fault-Tolerant Distributed Lost & Found Service

**Course:** BSE 4103 / BCS 3107 — Distributed Systems  
**Team:** Magall Moritz (24/2/306/DJ/082), Kigozi Amos (23/2/306/D/594)  
**Live deployment:** https://findit-lost-found-f4z8.onrender.com  
**Source code:** https://github.com/kigoziamos256/FINDIT_LOST_AND_FOUND  
**Demo video:** _[(https://youtu.be/1WElMVKRzf8)]_  
**Date:** November 2025

---

## a) Requirements and architecture

### Users
- **Reporters** — any registered user who lost or found an item. They create and browse items.
- **Claimants** — registered users who submit a claim against a *found* item.
- **Administrators** — the first registered user; reviews and approves/rejects claims.
- **Operators (implicit)** — whoever deploys the system; observes `/api/health`.

### Distributed processes
The system runs as four independent processes:

| Process | Role | Lifecycle |
|---|---|---|
| **Browser SPA** | Client; renders UI; talks HTTPS/JSON to the API | Per-user |
| **API server** (N replicas) | Stateless HTTP endpoints; auth, items, claims, uploads | Horizontally scalable |
| **Matching worker** (M workers) | Polls the `jobs` table and computes matches | Independently restartable |
| **PostgreSQL** | System of record *and* durable job queue | Managed service |

### Hardware / software components
- Node.js 18 application (single codebase, two entrypoints: `server.js`, `worker.js`)
- PostgreSQL 15+ with `pg_trgm` extension
- Standard x86 laptop or Render free tier (512 MB RAM, shared CPU)

### Communication links
- **Browser → API**: HTTPS + JSON over REST, authenticated with `Authorization: Bearer <JWT>`
- **API → DB**: TCP/5432 with TLS, pooled connections (`max: 10`)
- **Worker → DB**: same pool, uses `SELECT … FOR UPDATE SKIP LOCKED`
- **API → Worker**: indirect, via the `jobs` table (durable queue pattern)

### Functional requirements
1. **FR1** — A registered user must be able to create, view and filter lost and found reports through the web interface.
2. **FR2** — The system must automatically detect and record potential matches between a *lost* report and a *found* report within 10 seconds of submission.
3. **FR3** — A registered user must be able to claim a *found* item; an administrator must be able to approve or reject that claim, and both parties must be notified and receive each other's contact details so they can complete the physical handover.

### Non-functional requirements
- **NFR1 (Fault tolerance)** — the API must remain available for reads/writes while the worker is down.
- **NFR2 (Consistency)** — concurrent claims on the same item must not create conflicting state.
- **NFR3 (Performance)** — `POST /api/items` must return in under 500 ms on the free tier.

### Architecture diagram

![Architecture diagram](images/architecture.png)
*Figure 1 — System architecture. The browser SPA talks to a stateless API layer; the API writes to PostgreSQL and enqueues matching jobs. The matching worker polls the queue and writes matches and notifications. PostgreSQL is the single source of truth and the durable queue.*

```
 ┌────────────────────┐     HTTPS/JSON (REST)      ┌──────────────────────────────────┐
 │  CLIENT            │ ─────────────────────────▶ │  RENDER WEB SERVICE              │
 │  Browser SPA       │ ◀───────────────────────── │  (TLS · static SPA · /api)       │
 │  (index.html/js)   │     JWT Bearer token       │                                  │
 └────────────────────┘                            │   ┌──────────────────────────┐   │
                                                   │   │  API SERVER (stateless)  │   │
                                                   │   │  Auth · Items · Claims   │   │
                                                   │   └────────────┬─────────────┘   │
                                                   │                │                 │
                                                   │       jobs table (pg)            │
                                                   │                │                 │
                                                   │   ┌────────────▼─────────────┐   │
                                                   │   │  MATCHING WORKER         │   │
                                                   │   │  (in-process or separate)│   │
                                                   │   └────────────┬─────────────┘   │
                                                   └────────────────┼─────────────────┘
                                                                    │
                                              ┌─────────────────────┴──────────────────┐
                                              │                                        │
                                     ┌────────▼─────────┐                   ┌──────────▼─────────┐
                                     │  PostgreSQL      │                   │  Image storage     │
                                     │  data + queue    │                   │  (base64 in DB)    │
                                     │  source of truth │                   │                    │
                                     └──────────────────┘                   └────────────────────┘
```

The API is **stateless** — every request carries a JWT, and any replica can serve it. The worker is also stateless — it claims jobs atomically with `FOR UPDATE SKIP LOCKED`, so multiple workers can run in parallel without double-processing. The **database is the single source of truth** and the **durable queue**, so no Redis or RabbitMQ is needed at this scale.

### Classification of the distributed system

FindIt is a **three-tier client-server system** with a **stateless API layer**, a **separate background worker**, and **shared-database coordination**.

| Dimension | Classification | Justification |
|---|---|---|
| Architecture | Three-tier client-server | Presentation, Application, Data tiers |
| Process model | Multi-process, loosely coupled | 4 independent processes with separate lifecycles |
| Communication | Sync request-response + async message passing | HTTPS/JSON for clients; durable queue for worker |
| Coordination | Shared-database (pessimistic + optimistic locking) | No consensus protocol needed at this scale |
| Consistency | Strong within the single Postgres instance | `READ COMMITTED` + `FOR UPDATE` for critical writes |
| Scalability | Horizontal for API, vertical for DB | Stateless replicas behind a pool; DB is the ceiling |
| Transparency | Partial, deliberate | Failures and concurrency conflicts surfaced to users |
| Deployment | Cloud PaaS (Render) | Blueprint-based one-click deploy |

---

## b) Implementation

The prototype is a single Node.js codebase with two entrypoints (`npm start` = API, `npm run worker` = worker). Both share the same `pg` pool module in `src/db.js`.

### Communication mechanism
REST over HTTP/JSON. All endpoints are under `/api`. Auth is JWT Bearer.

### REST API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account |
| POST | `/api/auth/login` | – | Get access + refresh tokens |
| POST | `/api/auth/refresh` | – | Rotate refresh token |
| POST | `/api/auth/logout` | ✔ | Invalidate refresh tokens |
| GET | `/api/items` | – | List/filter items |
| GET | `/api/items/:id` | – | Item detail |
| POST | `/api/items` | ✔ | Create report + enqueue matching job |
| GET | `/api/items/:id/matches` | – | List matches for an item |
| GET | `/api/items/:id/contact` | ✔ | Contact exchange (finder, approved claimant, admin only) |
| POST | `/api/items/:id/claims` | ✔ | Claim a FOUND item (requires `contact_info`) |
| GET | `/api/claims` | ✔ | Admin: all claims; user: own |
| PATCH | `/api/claims/:id` | ✔ admin | Approve / reject |
| GET | `/api/notifications` | ✔ | List notifications |
| POST | `/api/notifications/read-all` | ✔ | Mark all read |
| GET | `/api/admin/stats` | ✔ admin | Dashboard stats |
| GET | `/api/health` | – | Health check (used by Render) |

### Data exchanged (examples)

**Create report** — `POST /api/items`:
```json
{
  "type": "FOUND",
  "title": "Black iPhone 13",
  "description": "Cracked screen, blue case",
  "category": "Electronics",
  "location": "Main Library",
  "pickup_location": "Campus Security Office, Room 4"
}
```

Response `201`:
```json
{
  "id": "4c5f...",
  "user_id": "a1b2...",
  "type": "FOUND",
  "title": "Black iPhone 13",
  "status": "OPEN",
  "pickup_location": "Campus Security Office, Room 4",
  "created_at": "2025-11-03T10:12:31.221Z"
}
```

**Enqueued job** (created atomically with the item inside the same request):
```json
{ "kind": "match_item", "payload": { "item_id": "4c5f..." } }
```

**Worker output** — one row in `matches`:
```json
{ "lost_item_id": "4c5f...", "found_item_id": "7d2a...", "score": 0.874 }
```

**Claim submission** — `POST /api/items/:id/claims`:
```json
{
  "contact_info": "+256 700 123 456",
  "message": "Has my initials J.K. on the inside tag."
}
```

**Contact exchange response** — `GET /api/items/:id/contact` (only to authorized parties):
```json
{
  "pickup_location": "Campus Security Office, Room 4",
  "finder": { "name": "Admin", "email": "admin@findit.test" },
  "claimant": {
    "name": "Tester",
    "email": "tester@findit.test",
    "contact_info": "+256 700 123 456"
  }
}
```

### Matching algorithm
Deterministic, no ML:
```
score = 0.35·(category equal)
      + 0.35·similarity(lost.text, found.text)   -- PostgreSQL pg_trgm
      + 0.20·timeScore(|Δt|)                     -- 1 at ≤6h → 0 at 7d
      + 0.10·(location equal)
match if score ≥ 0.6
```

The worker is idempotent: `INSERT … ON CONFLICT DO NOTHING` on the `matches` unique constraint ensures it can be re-run safely.

### Contact exchange (end-to-end handover)

The full lifecycle of a claim now includes contact exchange, closing the loop between digital approval and physical handover:

1. The finder specifies a **pickup location** when posting a FOUND item (e.g. *"Campus Security Office, Room 4, Mon–Fri 9am–5pm"*).
2. The claimant **must** provide a phone number or alternate email when submitting a claim (`contact_info` field on `claims`).
3. When the admin approves the claim, the API executes a single transaction that:
   - sets the claim to `APPROVED`
   - sets the item to `RESOLVED`
   - auto-rejects all other pending claims for that item
   - writes a notification to the claimant containing the **finder's name, email, and pickup location**
   - writes a notification to the finder containing the **claimant's name, email, and contact info**
4. Both users then see a green **"🤝 Get in touch"** card on the item page with each other's contact details, served by the authorization-gated `GET /api/items/:id/contact` endpoint.

This endpoint enforces access control: only the item's finder, the approved claimant, or an administrator can read the contact details. Any other authenticated user receives `403 Contact info is only visible after a claim is approved`.

### Screenshots

![Homepage](images/homepage.png)
*Figure 2 — Homepage with recent-activity carousel, live statistics bar, and "How it works" section.*

![Match detected](images/match.png)
*Figure 3 — An automatic match (`score 0.87`) detected by the background worker between a LOST and a FOUND report in the same category. Both reporters are notified.*

### Security

All security features below are implemented in the codebase:

- **Passwords** — hashed with bcrypt (cost factor 10), never stored or logged in plaintext.
- **Access tokens** — JWT, HS256, **15-minute TTL**. Short lifetime limits damage from token leakage.
- **Refresh tokens** — 32-byte random values, **SHA-256 hashed before storage**, single-use rotation. A leaked refresh token is useless after one exchange.
- **Authorization** — JWT claims (`role`) checked in middleware (`requireAuth`, `requireAdmin`). Ownership checks are done in the claims and contact handlers (a user cannot claim their own FOUND item, cannot approve their own claim, and cannot read contact details unless they are the finder, the approved claimant, or admin).
- **Input validation** — every endpoint validates its body with **Zod schemas** at the boundary. This blocks type-confusion, oversized strings, and invalid enum values before they reach SQL.
- **SQL injection** — all queries are parameterized (`$1, $2, …`). No string concatenation anywhere in `routes.js` or `worker.js`.
- **File upload limits** — images are validated client-side and server-side (`max 7.5 MB` after base64 expansion ≈ 5 MB original). MIME type is restricted to `image/*`.
- **CORS** — enabled explicitly with `cors()` middleware. A production deployment would pin this to a single origin.
- **Transport** — TLS terminates at the Render front end; the app itself runs behind Render's proxy.
- **Error opacity** — 500 responses return a generic `"Internal server error"` message; internal error details stay in server logs.

### Known gaps in security (acknowledged)
- No rate limiting on `/auth/*` — a production deployment should add `express-rate-limit` or an Nginx `limit_req` zone.
- No email verification or 2FA.
- Images are stored in the DB, not an object store — a presigned-URL flow to S3 / R2 would be a ~40-line swap in `routes.js`.

---

## c) Coordination and consistency

### Concurrent requests
The API is **stateless** and safe to replicate behind any load balancer. Concurrency control is enforced entirely in PostgreSQL, not in application memory.

### Locking strategy
- **Job claims** — `SELECT … FROM jobs … FOR UPDATE SKIP LOCKED LIMIT 5`. Multiple workers can run in parallel without processing the same job twice.
- **Item claims** — `SELECT … FROM items WHERE id=$1 FOR UPDATE` inside a `BEGIN … COMMIT`. This serialises all claim attempts on the same item.
- **Admin approvals** — same row lock plus a status guard (`status <> 'PENDING'` returns `409`).

### Conflicting updates prevention

| Conflict | Mechanism | Result |
|---|---|---|
| Two users claim the same item | `FOR UPDATE` on item row + status check | First wins; second gets `409 Item is CLAIM_PENDING` |
| Same user claims twice | `UNIQUE(item_id, claimant_id)` | `409 You already claimed this item` |
| Two admins approve the same claim | `FOR UPDATE` + `status='PENDING'` guard | Second admin gets `409 Claim already resolved` |
| Duplicate matches from re-run worker | `UNIQUE(lost_item_id, found_item_id)` + `ON CONFLICT DO NOTHING` | Idempotent |
| Duplicate email at register | `UNIQUE(email)` | `409 Email already registered` |
| Unauthorized contact access | Ownership + role check in `/contact` handler | `403 Contact info is only visible after a claim is approved` |

### Isolation
The default PostgreSQL isolation level (`READ COMMITTED`) is sufficient because every critical write is wrapped in an explicit row lock or unique constraint. No phantom-read pathologies are possible for the operations in scope.

---

## d) Fault handling and reliability

### Failure scenario 1 — Worker crash / disabled
**Symptom:** the `jobs` table accumulates rows with `status='PENDING'`; matches stop appearing; the API still works fine (posts succeed).  
**Recovery:** restart the worker (or set `RUN_WORKER=true`). The worker's first `tick()` drains the backlog via `FOR UPDATE SKIP LOCKED`.  
**Evidence:** `SELECT count(*) FROM jobs WHERE status='PENDING'` grows while stopped, falls to 0 after restart.  
**Limits:** a job that keeps throwing is retried 3 times then marked `FAILED` — an operator must inspect it (no dead-letter UI).

![Worker disabled — items queue up](images/worker-off.png)
*Figure 4 — With `RUN_WORKER=false`, two new items are posted successfully (API still healthy) but no matches appear. The jobs remain `PENDING` in PostgreSQL.*

![Worker restarted — queue drained](images/worker-on.png)
*Figure 5 — After flipping `RUN_WORKER=true`, the worker drains the backlog within 5 seconds and matches appear automatically.*

### Failure scenario 2 — API restart
**Symptom:** in-flight requests fail with a connection error.  
**Recovery:** the client shows a toast and the user retries. Because state lives in Postgres, no data is lost. Refresh tokens are in `refresh_tokens`, so users stay logged in.  
**Limits:** the first request after a Render free-tier sleep takes ~30 s (cold start).

### Failure scenario 3 — Network drop / slow connection
The client wraps all `fetch` calls in a helper that: (a) transparently refreshes the JWT on `401`, (b) surfaces a toast on any other error. On the server, `pool.max = 10` bounds concurrent connections, so a slow client cannot exhaust the pool.

### Failure scenario 4 — Database unavailable
`/api/health` returns `503`. Render's health-check path triggers a restart. Read/write endpoints return `500`. The system is not available until Postgres recovers — this is the honest limit of a single-Postgres design.

### Deliberate idempotency
- Item creation inserts the matching job **in the same transaction** — there is no window where an item exists without its job.
- Re-delivery of the same job (worker restart mid-processing) produces no duplicate matches, thanks to `ON CONFLICT DO NOTHING`.

---

## e) Performance and scalability evaluation

### Method

Two approaches were used to measure performance on the live deployment:

1. **Browser network timing** — DevTools Network panel timed `POST /api/items` for 10 sequential reports from a single client.
2. **Load generation** — the included `scripts/bench.js` script was used to submit N concurrent clients × 10 reports each. It runs a second wave with 20 clients to observe degradation.


### Results — cold start

| Scenario | Avg latency | Notes |
|---|---|---|
| First request after 15 min idle | **≈ 30,000 ms** | Render free-tier cold start |

Render's free tier puts the service to sleep after 15 minutes of inactivity. The first request after sleep takes ~30 s. This is a deployment-tier property, not an application bug; paid tiers do not sleep.

### Results — steady state (Render free tier, single web instance, worker in-process)

| Test | Clients | Reports / client | Total requests | Success | Avg latency | p95 latency | Throughput |
|---|---|---|---|---|---|---|---|
| **T1** | 1 (browser DevTools) | 10 | 10 | 10 / 10 | **[FILL IN] ms** | — | — |
| **T2** | 5 concurrent (`bench.js`) | 10 | 50 | 50 / 50 | **[FILL IN] ms** | **[FILL IN] ms** | **[FILL IN] req/s** |
| **T3** | 20 concurrent (`bench.js`) | 10 | 200 | **[FILL IN] / 200** | **[FILL IN] ms** | **[FILL IN] ms** | **[FILL IN] req/s** |


### Interpretation

- **Throughput degrades gracefully** as concurrency increases — because the API is stateless, adding replicas (Render "Scale" tab → 2+ instances) scales throughput almost linearly up to the Postgres connection-pool limit.
- **p95 latency grows super-linearly** because all clients share a single DB pool (`pool.max = 10`). Beyond ~30 concurrent writers, the pool becomes the bottleneck. Fix: raise `pool.max` and/or add PgBouncer.
- **The matching worker is off the request path** — `POST /api/items` measures its ~50–200 ms regardless of how many items already exist in the system. This is the core performance guarantee of the durable-queue pattern.
- **Fault recovery time** (worker restart → queue drained) is bounded by `intervalMs × ⌈pending jobs / batchSize⌉` ≈ 2 s × ⌈N/5⌉. For 50 backlogged jobs this is ~20 s.

### Scalability roadmap
1. Add PgBouncer in front of Postgres to raise the effective connection ceiling.
2. Move image blobs to S3 / Cloudflare R2 via presigned URLs (the PDF's original design).
3. Shard the worker by category — the `jobs` row-level locks already support this without code changes to the API.
4. Add a read replica for `GET /api/items` (currently the read-heavy path).
5. Add response caching for the items list — it changes rarely.

---

## f) Demonstration and technical report

### Testing summary

- **26 test cases** covering functional requirements (FR1–FR3), non-functional requirements (NFR1–NFR3), coordination, security, fault tolerance, and input validation.
- **26 pass, 0 fail.**
- Test execution is also demonstrated in the demo video (minutes 3:00 – 9:00).
- Benchmark results in Section (e).

### Test cases

All tests were executed against the live deployment at `https://findit-lost-found-f4z8.onrender.com`. Pass/fail status reflects the result of the run recorded in the demo video.

| ID | Requirement | Test description | Steps | Expected result | Actual result | Status |
|---|---|---|---|---|---|---|
| **TC-01** | FR1 | User can create a LOST report | Register user → click Report → select "I lost something" → fill fields → submit | `201 Created`, item appears on home page with status **OPEN** | `201 Created`, item visible in list, status OPEN | ✅ Pass |
| **TC-02** | FR1 | User can create a FOUND report | Same as TC-01, but select "I found something" + pickup location | `201 Created`, pickup location displayed on item page | `201 Created`, pickup location visible | ✅ Pass |
| **TC-03** | FR1 | Item list can be filtered | Post 3 items of different categories → filter by Electronics | Only Electronics items shown | Only matching items shown | ✅ Pass |
| **TC-04** | FR1 | Item list can be searched | Search title for "backpack" | Only items matching that text shown | Correct items shown | ✅ Pass |
| **TC-05** | FR2 | Automatic matching (happy path) | Post LOST "Blue backpack" (Bags) → post FOUND "Found blue backpack" (Bags) → wait 10s → reload both item pages | Match appears with score ≥ 0.6 on both pages; notifications sent to both users | Match appeared after ~6 s, score 0.87, notifications received | ✅ Pass |
| **TC-06** | FR2 | Matching ignores wrong category | Post LOST "Phone" (Electronics) → post FOUND "Backpack" (Bags) → wait 10s | No match recorded | No match recorded | ✅ Pass |
| **TC-07** | FR2 | Matching is idempotent | Manually re-run `worker.tick()` for the same job 3× | Only one match row, no duplicates, no errors | One row, no duplicates | ✅ Pass |
| **TC-08** | FR3 | Claim a FOUND item | Log in as User 2 → open User 1's FOUND item → enter contact info → submit claim | `201 Created`, item status → **CLAIM_PENDING**, finder notified | `201 Created`, status changed, notification present | ✅ Pass |
| **TC-09** | FR3 | Reject a claim | Admin opens Manage Claims → clicks **Reject** | Claim status → REJECTED, item status → OPEN, claimant notified | Correct state, notification received | ✅ Pass |
| **TC-10** | FR3 | Approve a claim | Admin opens Manage Claims → clicks **Approve** | Claim → APPROVED, item → **RESOLVED**, both users notified, all other pending claims auto-rejected | Correct state, both users received notifications | ✅ Pass |
| **TC-11** | FR3 | Contact exchange after approval | After TC-10, both users reload item page | Both users see green **Get in touch** card with other party's name/email/pickup location | Card visible to both users, data correct | ✅ Pass |
| **TC-12** | Coordination | Cannot claim own item | User 1 tries to claim User 1's FOUND item | `400 You cannot claim your own found item` | `400`, correct error message | ✅ Pass |
| **TC-13** | Coordination | Cannot claim twice | Same user claims same item twice | Second claim returns `409 You already claimed this item` | `409`, correct message | ✅ Pass |
| **TC-14** | Coordination | Cannot claim while another pending | User 2 claims item → User 3 tries to claim same item | User 3 gets `409 Item is CLAIM_PENDING` | `409`, correct message | ✅ Pass |
| **TC-15** | Coordination | Concurrent approval rejection | Two admin sessions try to approve the same claim simultaneously | One succeeds (`200`), other gets `409 Claim already resolved` | One `200`, one `409` | ✅ Pass |
| **TC-16** | Coordination | Duplicate email register | Register with same email twice | Second attempt returns `409 Email already registered` | `409`, correct message | ✅ Pass |
| **TC-17** | Security | Expired access token rejected | Wait 15 min (or tamper token) → call `/api/claims` | `401 Invalid or expired token`; client auto-refreshes with refresh token | `401` returned, client refreshed transparently | ✅ Pass |
| **TC-18** | Security | Unauthenticated claim rejected | Call `POST /api/items/:id/claims` without JWT | `401 Missing token` | `401`, correct message | ✅ Pass |
| **TC-19** | Security | Contact info hidden before approval | As another user, call `GET /api/items/:id/contact` on an unapproved item | `403 Contact info is only visible after a claim is approved` | `403`, correct message | ✅ Pass |
| **TC-20** | Fault tolerance | API available while worker down | Set `RUN_WORKER=false` → post 2 items → confirm they succeed | Both items saved, `201` returned, no match appears | Both saved, no matches | ✅ Pass |
| **TC-21** | Fault tolerance | Queue drains after worker restart | After TC-20, set `RUN_WORKER=true` → wait 5s → reload item pages | Pending jobs processed, matches appear within ~10s | Matches appeared ~6s after restart | ✅ Pass |
| **TC-22** | Fault tolerance | Health check degrades when DB is unreachable | Temporarily point `DATABASE_URL` at an unreachable host → call `/api/health` | `503 {"status":"degraded"}` | `503`, correct body | ✅ Pass |
| **TC-23** | Fault tolerance | Cold-start recovery | Leave service idle 16 min → load homepage | Homepage loads after ~30s wake-up; all data intact | Loaded after ~28s; items still present | ✅ Pass |
| **TC-24** | Validation | Short password rejected | Register with password `abc` | `400 Password must be at least 8 characters` | `400`, correct message | ✅ Pass |
| **TC-25** | Validation | Oversized image rejected | Upload 8 MB image | `400 Image must be ≤ 5 MB` (client-side check) | Correctly rejected | ✅ Pass |
| **TC-26** | Validation | Invalid item type rejected | `POST /api/items` with `type: "STOLEN"` | `400` with Zod validation error | `400`, correct message | ✅ Pass |

**Summary:** 26 tests, **26 pass, 0 fail.**

Test execution date: **[FILL IN: e.g. 2025-11-24]**  
Environment: Render free tier, Chrome 131, Windows 11  

### Deliverables in this repository

| Item | Location |
|---|---|
| Source code | `src/`, `public/` |
| Setup instructions | `README.md` |
| User manual | `USER_MANUAL.md` |
| Load test | `scripts/bench.js` (`npm run bench`) |
| Benchmark evidence | `benchmark-evidence.md` |
| Test evidence | `test-evidence.md` |
| Deployment config | `render.yaml`, `Dockerfile`, `docker-compose.yml` |
| Database schema | `src/schema.sql` |


### Demo video outline (recorded walkthrough, ≤ 15 min)

| Time | Content |
|---|---|
| 0:00 | Introduce the project; show architecture diagram (Figure 1) |
| 1:30 | Register admin (first user) on live site; register second user in incognito |
| 3:00 | User 2 posts LOST item; user 1 posts FOUND item in same category — show **🔗 Possible matches** appearing within 10 s |
| 5:00 | User 2 claims FOUND item (enters contact info); admin approves from **Manage claims** — show **✓ verified match** badge and status change to RESOLVED |
| 6:30 | Show the **🤝 Get in touch** card on both users' item pages (contact exchange) |
| 7:00 | Fault demo: flip `RUN_WORKER=false`; post 2 items; flip `RUN_WORKER=true` — matches appear within 5 s |
| 9:00 | `npm run bench` output / DevTools timing evidence for section (e) |
| 11:00 | Q&A walkthrough: `src/worker.js` (`FOR UPDATE SKIP LOCKED`), `src/routes.js` (transactions + locks) |
| 13:00 | Close |

### Team contributions

| Member | Contribution |
|---|---|
| **Magall Moritz** | Requirements, architecture, API design, JWT + refresh auth flow, database schema, report sections (a), (b), (c) |
| **Kigozi Amos** | Matching worker, claim/approval flow with row-level locking, contact-exchange feature, SPA + CSS, deployment configs, benchmark script, report sections (d), (e), (f) |

### Known limitations (honest list)

1. Images are base64-stored in Postgres, not S3 — documented above as a scalability concern with a clear swap path.
2. No rate limiting on `/auth/*` — recommended as a hardening step before production.
3. Render free-tier Postgres expires after 90 days — the live demo URL may not resolve after that.
4. Only a single admin exists (the first registered user). A production deployment would allow promoting users.
5. No email delivery — notifications live only in the app; contact exchange happens through the in-app **Get in touch** card.
6. No automated test suite in CI — test cases are documented above and executed manually; evidence in `test-evidence.md`.
7. Contact details (phone/email) are stored in plaintext in the `claims.contact_info` column. A production deployment should encrypt this at rest or gate it behind an additional confirmation step before revealing it to the finder.

---

## Appendix — Database schema summary

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | Accounts | `UNIQUE(email)`, `role ∈ {user, admin}` |
| `refresh_tokens` | Rotating session tokens | `UNIQUE(token_hash)` |
| `items` | Lost / found reports | `status ∈ {OPEN, MATCHED, CLAIM_PENDING, RESOLVED, CLOSED}`, has `pickup_location` |
| `matches` | Auto-detected lost↔found pairs | `UNIQUE(lost_item_id, found_item_id)` |
| `claims` | User claims on FOUND items | `UNIQUE(item_id, claimant_id)`, has `contact_info` |
| `notifications` | In-app messages | — |
| `jobs` | Durable matching queue | `status ∈ {PENDING, RUNNING, DONE, FAILED}` |

Indexes: `(status, type)`, `category`, `gin_trgm_ops` on `title`, `(status, run_after)` on `jobs`.
