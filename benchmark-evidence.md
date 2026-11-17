# Benchmark Evidence — Section (e)

This file records the raw measurements referenced in `REPORT.md` section (e).

Deployment: Render free tier, single web instance, worker in-process  
Live URL: https://findit-lost-found-f4z8.onrender.com

---

## 1. Cold start measurement (browser DevTools)

**Steps followed:**
1. Left the site idle for 16 minutes (Render auto-sleeps after 15 min).
2. Opened DevTools (F12) → Network tab.
3. Navigated to the homepage.
4. Recorded the time of the first request to complete.

**Result:** `[FILL IN] ms` (usually ≈ 25,000 – 35,000 ms on first wake).

Screenshot: `images/cold-start.png`

---

## 2. Sequential single-client latency (T1)

**Steps followed:**
1. DevTools → Network tab → filter `items`.
2. Posted 10 items in a row from the same browser session.
3. Recorded each `POST /api/items` Time value.

**Recorded times (ms):**

| # | Time |
|---|---|
| 1 | `[FILL IN]` |
| 2 | `[FILL IN]` |
| 3 | `[FILL IN]` |
| 4 | `[FILL IN]` |
| 5 | `[FILL IN]` |
| 6 | `[FILL IN]` |
| 7 | `[FILL IN]` |
| 8 | `[FILL IN]` |
| 9 | `[FILL IN]` |
| 10 | `[FILL IN]` |

**Average:** `[FILL IN] ms`

Screenshot: `images/network-timing.png`

---

## 3. Concurrent load test — 5 clients (T2)

**Steps followed:**
1. Opened Render dashboard → `findit-lost-found` service → **Shell** tab.
2. Ran:
   ```
   BASE=https://findit-lost-found-f4z8.onrender.com node scripts/bench.js
   ```
3. The script first runs 5 clients × 10 reports = 50 requests.
4. Copied the printed output here.

**Raw output:**
```
[PASTE THE OUTPUT HERE]
```

Summary:

| Metric | Value |
|---|---|
| Total requests | 50 |
| Successful | `[FILL IN]` |
| Failed | `[FILL IN]` |
| Average latency | `[FILL IN] ms` |
| p95 latency | `[FILL IN] ms` |
| Throughput | `[FILL IN] req/s` |

Screenshot: `images/benchmark-5.png`

---

## 4. Concurrent load test — 20 clients (T3)

**Steps followed:** Same as §3, but `bench.js` automatically runs a second wave with 20 clients × 10 reports = 200 requests.

**Raw output:**
```
[PASTE THE OUTPUT HERE]
```

Summary:

| Metric | Value |
|---|---|
| Total requests | 200 |
| Successful | `[FILL IN]` |
| Failed | `[FILL IN]` |
| Average latency | `[FILL IN]` |
| p95 latency | `[FILL IN]` |
| Throughput | `[FILL IN]` |

Screenshot: `images/benchmark-20.png`

---

## 5. Fault recovery time

**Steps followed:**
1. On Render dashboard → Environment → set `RUN_WORKER=false` → Save (service restarts).
2. Registered two accounts and posted 3 items in each — confirmed no matches appear.
3. Set `RUN_WORKER=true` → Save (service restarts).
4. Timed how long until the first match appeared on the item detail page.

**Result:** `[FILL IN] seconds`

Screenshot: `images/worker-on.png`
