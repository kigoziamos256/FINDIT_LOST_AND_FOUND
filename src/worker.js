const pool = require('./db');

const SCORE_THRESHOLD = 0.6;
const MAX_CANDIDATES  = 200;

function timeScore(aISO, bISO) {
  const hours = Math.abs(new Date(aISO) - new Date(bISO)) / 3_600_000;
  if (hours <= 6) return 1;
  if (hours >= 168) return 0;           // 7 days
  return 1 - (hours - 6) / 162;
}

async function processJob(client, job) {
  const itemId = job.payload.item_id;

  const { rows: [item] } = await client.query('SELECT * FROM items WHERE id=$1', [itemId]);
  if (!item) return;

  const opposite = item.type === 'LOST' ? 'FOUND' : 'LOST';

  // pg_trgm similarity — ordered so the best candidates are handled first.
  const { rows: candidates } = await client.query(
    `SELECT c.*, similarity($1, c.title || ' ' || coalesce(c.description,'')) AS text_sim
     FROM items c
     WHERE c.type = $2 AND c.id <> $3
     ORDER BY text_sim DESC
     LIMIT ${MAX_CANDIDATES}`,
    [`${item.title} ${item.description || ''}`, opposite, item.id]
  );

  for (const c of candidates) {
    const categoryEqual = c.category.toLowerCase() === item.category.toLowerCase();
    const locationEqual = (c.location || '').toLowerCase() === (item.location || '').toLowerCase();
    const ts = timeScore(c.created_at, item.created_at);
    const sim = Number(c.text_sim) || 0;

    const score =
      0.35 * (categoryEqual ? 1 : 0) +
      0.35 * sim +
      0.20 * ts +
      0.10 * (locationEqual ? 1 : 0);

    if (score < SCORE_THRESHOLD) continue;

    const lostId  = item.type === 'LOST'  ? item.id : c.id;
    const foundId = item.type === 'FOUND' ? item.id : c.id;

    const { rowCount } = await client.query(
      `INSERT INTO matches (lost_item_id, found_item_id, score)
       VALUES ($1, $2, $3)
       ON CONFLICT (lost_item_id, found_item_id) DO NOTHING`,
      [lostId, foundId, score.toFixed(3)]
    );

    if (rowCount === 0) continue; // already recorded

    const { rows: [lostOwner] }  = await client.query('SELECT user_id FROM items WHERE id=$1', [lostId]);
    const { rows: [foundOwner] } = await client.query('SELECT user_id FROM items WHERE id=$1', [foundId]);

    await client.query(
      `INSERT INTO notifications (user_id, message) VALUES ($1,$2),($3,$4)`,
      [
        lostOwner.user_id,  `🔗 New possible match for your lost item (score ${score.toFixed(2)})`,
        foundOwner.user_id, `🔗 New possible match for the item you found (score ${score.toFixed(2)})`,
      ]
    );

    await client.query(
      `UPDATE items SET status='MATCHED' WHERE id IN ($1,$2) AND status='OPEN'`,
      [lostId, foundId]
    );
  }
}

async function tick() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: jobs } = await client.query(
      `SELECT * FROM jobs
       WHERE status='PENDING' AND run_after <= now()
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 5`
    );

    for (const job of jobs) {
      await client.query(
        `UPDATE jobs SET status='RUNNING', attempts = attempts + 1 WHERE id=$1`,
        [job.id]
      );
      try {
        if (job.kind === 'match_item') await processJob(client, job);
        await client.query(`UPDATE jobs SET status='DONE' WHERE id=$1`, [job.id]);
      } catch (e) {
        console.error(`job ${job.id} failed:`, e.message);
        await client.query(
          `UPDATE jobs
           SET status = CASE WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
               run_after = now() + interval '5 seconds'
           WHERE id=$1`,
          [job.id]
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('worker tick error:', e.message);
  } finally {
    client.release();
  }
}

function startWorker(intervalMs = 2000) {
  console.log('🔧 Matching worker started (polling every', intervalMs, 'ms)');
  return setInterval(tick, intervalMs);
}

module.exports = { startWorker, tick };

// If run directly (`npm run worker`), start a standalone worker loop.
if (require.main === module) startWorker();
