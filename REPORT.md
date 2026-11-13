# Project Report — FindIt: A Fault-Tolerant Distributed Lost & Found Service

**Course:** BSE 4103 / BCS 3107 — Distributed Systems  
**Team:** Magall Moritz (24/2/306/DJ/082), Kigozi Amos (23/2/306/D/594)

---

## a) Requirements and architecture

### Users
- **Reporters** — any registered user who lost or found an item. They create and browse items.
- **Claimants** — registered users who submit a claim against a *found* item.
- **Administrators** — the first registered user; reviews and approves/rejects claims.
- **Operations (implicit)** — whoever deploys the system; observes `/api/health`.

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
- **API → DB**: TCP/5432 with TLS, pooled connections
- **Worker → DB**: same pool, uses `SELECT … FOR UPDATE SKIP LOCKED`
- **API → Worker**: indirect, via the `jobs` table (durable queue pattern)

### Functional requirements
1. **FR1** — A registered user must be able to create, view and filter lost and found reports through the web interface.
2. **FR2** — The system must automatically detect and record potential matches between a *lost* report and a *found* report within 10 seconds of submission.
3. **FR3** — A registered user must be able to claim a *found* item; an administrator must be able to approve or reject that claim, and both parties must be notified.

### Non-functional requirements
- **NFR1 (Fault tolerance)** — the API must remain available for reads/writes while the worker is down.
- **NFR2 (Consistency)** — concurrent claims on the same item must not create conflicting state.
- **NFR3 (Performance)** — `POST /api/items` must return in under 500 ms on the free tier.

### Architecture diagram
