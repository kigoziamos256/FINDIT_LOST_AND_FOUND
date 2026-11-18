const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const pool = require('./db');
const { sign, requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// ---------- helpers ----------
const REFRESH_TTL_DAYS = 7;
const hashRefresh = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function issueTokens(user) {
  const access = sign(user);
  const refresh = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [user.id, hashRefresh(refresh), REFRESH_TTL_DAYS]
  );
  return { access, refresh };
}

// =====================================================
// AUTH
// =====================================================
router.post('/auth/register', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().min(1).max(80),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { email, password, name } = parsed.data;

  const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM users');
  const role = count === 0 ? 'admin' : 'user';

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role`,
      [email.toLowerCase(), hash, name, role]
    );
    const tokens = await issueTokens(user);
    res.status(201).json({ user, ...tokens });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    throw e;
  }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  const tokens = await issueTokens(user);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, ...tokens });
});

router.post('/auth/refresh', async (req, res) => {
  const { refresh } = req.body || {};
  if (!refresh) return res.status(400).json({ error: 'Missing refresh token' });
  const { rows: [row] } = await pool.query(
    `SELECT rt.*, u.id AS uid, u.email, u.role, u.name
     FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.expires_at > now()`,
    [hashRefresh(refresh)]
  );
  if (!row) return res.status(401).json({ error: 'Invalid refresh token' });
  await pool.query('DELETE FROM refresh_tokens WHERE token_hash=$1', [hashRefresh(refresh)]);
  const user = { id: row.uid, email: row.email, role: row.role, name: row.name };
  const tokens = await issueTokens(user);
  res.json({ user, ...tokens });
});

router.post('/auth/logout', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.user.sub]);
  res.json({ ok: true });
});

// =====================================================
// ITEMS
// =====================================================
router.get('/items', async (req, res) => {
  const { type, category, q, status } = req.query;
  const conds = [];
  const vals = [];
  let i = 1;
  if (type)     { conds.push(`type=$${i++}`);     vals.push(String(type).toUpperCase()); }
  if (category) { conds.push(`category=$${i++}`); vals.push(category); }
  if (status)   { conds.push(`status=$${i++}`);   vals.push(String(status).toUpperCase()); }
  if (q) {
    conds.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
    vals.push(`%${q}%`); i++;
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT i.*, u.name AS reporter_name
     FROM items i JOIN users u ON u.id = i.user_id
     ${where}
     ORDER BY i.created_at DESC
     LIMIT 100`,
    vals
  );
  res.json(rows);
});

router.get('/items/:id', async (req, res) => {
  const { rows: [item] } = await pool.query(
    `SELECT i.*, u.name AS reporter_name
     FROM items i JOIN users u ON u.id = i.user_id
     WHERE i.id = $1`,
    [req.params.id]
  );
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

router.post('/items', requireAuth, async (req, res) => {
  const schema = z.object({
    type: z.enum(['LOST', 'FOUND']),
    title: z.string().min(2).max(120),
    description: z.string().max(2000).default(''),
    category: z.string().min(1).max(40),
    location: z.string().max(120).default(''),
    pickup_location: z.string().max(200).default(''),
    image_data: z.string().max(7_500_000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const d = parsed.data;

  const { rows: [item] } = await pool.query(
    `INSERT INTO items (user_id, type, title, description, category, location, pickup_location, image_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.sub, d.type, d.title, d.description, d.category, d.location, d.pickup_location, d.image_data || null]
  );

  await pool.query(
    `INSERT INTO jobs (kind, payload) VALUES ('match_item', $1)`,
    [JSON.stringify({ item_id: item.id })]
  );

  res.status(201).json(item);
});

router.get('/items/:id/matches', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.score, m.created_at,
            li.id AS lost_id,  li.title AS lost_title,
            fi.id AS found_id, fi.title AS found_title,
            li.category
     FROM matches m
     JOIN items li ON li.id = m.lost_item_id
     JOIN items fi ON fi.id = m.found_item_id
     WHERE m.lost_item_id = $1 OR m.found_item_id = $1
     ORDER BY m.score DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// ---------- Contact exchange (Option C) ----------
// Only authorized parties can read each other's contact info:
//   - the finder of this item
//   - an APPROVED claimant
//   - the admin
router.get('/items/:id/contact', requireAuth, async (req, res) => {
  const itemId = req.params.id;
  const { rows: [item] } = await pool.query(
    `SELECT i.*, u.email AS finder_email, u.name AS finder_name
     FROM items i JOIN users u ON u.id = i.user_id
     WHERE i.id = $1`,
    [itemId]
  );
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const isFinder = item.user_id === req.user.sub;
  const isAdmin = req.user.role === 'admin';

  const { rows: [approved] } = await pool.query(
    `SELECT c.*, u.email AS claimant_email, u.name AS claimant_name
     FROM claims c JOIN users u ON u.id = c.claimant_id
     WHERE c.item_id = $1 AND c.status = 'APPROVED'`,
    [itemId]
  );
  const isApprovedClaimant = approved && approved.claimant_id === req.user.sub;

  if (!isFinder && !isAdmin && !isApprovedClaimant) {
    return res.status(403).json({ error: 'Contact info is only visible after a claim is approved' });
  }

  res.json({
    pickup_location: item.pickup_location || '',
    finder: { name: item.finder_name, email: item.finder_email },
    claimant: approved ? {
      name: approved.claimant_name,
      email: approved.claimant_email,
      contact_info: approved.contact_info,
    } : null,
  });
});

// =====================================================
// CLAIMS
// =====================================================
router.post('/items/:id/claims', requireAuth, async (req, res) => {
  const { message, contact_info } = req.body || {};
  const contactTrimmed = String(contact_info || '').trim();
  if (!contactTrimmed) {
    return res.status(400).json({ error: 'Contact info is required so the finder can reach you' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [item] } = await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
    if (item.type !== 'FOUND') throw Object.assign(new Error('Only FOUND items can be claimed'), { status: 400 });
    if (!['OPEN', 'MATCHED'].includes(item.status))
      throw Object.assign(new Error(`Item is ${item.status} — cannot claim right now`), { status: 409 });
    if (item.user_id === req.user.sub)
      throw Object.assign(new Error('You cannot claim your own found item'), { status: 400 });

    const { rows: [claim] } = await client.query(
      `INSERT INTO claims (item_id, claimant_id, message, contact_info)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, claimant_id) DO NOTHING
       RETURNING *`,
      [item.id, req.user.sub, message || '', contactTrimmed.slice(0, 200)]
    );
    if (!claim) throw Object.assign(new Error('You already claimed this item'), { status: 409 });

    await client.query(`UPDATE items SET status='CLAIM_PENDING' WHERE id=$1`, [item.id]);
    await client.query(
      `INSERT INTO notifications (user_id, message) VALUES ($1,$2)`,
      [item.user_id, `New claim on your found item "${item.title}"`]
    );
    await client.query('COMMIT');
    res.status(201).json(claim);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.get('/claims', requireAuth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const { rows } = await pool.query(
    `SELECT c.*, i.title AS item_title, i.id AS item_id,
            u.name AS claimant_name, u.email AS claimant_email,
            EXISTS (
              SELECT 1 FROM matches m
              JOIN items li ON li.id = m.lost_item_id
              WHERE m.found_item_id = c.item_id AND li.user_id = c.claimant_id
            ) AS claimant_has_match
     FROM claims c
     JOIN items i ON i.id = c.item_id
     JOIN users u ON u.id = c.claimant_id
     ${isAdmin ? '' : 'WHERE c.claimant_id = $1 OR i.user_id = $1'}
     ORDER BY c.created_at DESC
     LIMIT 100`,
    isAdmin ? [] : [req.user.sub]
  );
  res.json(rows);
});

router.patch('/claims/:id', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['APPROVED', 'REJECTED'].includes(status))
    return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [claim] } = await client.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!claim) throw Object.assign(new Error('Claim not found'), { status: 404 });
    if (claim.status !== 'PENDING') throw Object.assign(new Error('Claim already resolved'), { status: 409 });

    await client.query(`UPDATE claims SET status=$1 WHERE id=$2`, [status, claim.id]);

    const { rows: [item] } = await client.query('SELECT * FROM items WHERE id=$1', [claim.item_id]);
    const { rows: [finder] } = await client.query('SELECT name, email FROM users WHERE id=$1', [item.user_id]);
    const { rows: [claimant] } = await client.query('SELECT name, email FROM users WHERE id=$1', [claim.claimant_id]);

    if (status === 'APPROVED') {
      await client.query(`UPDATE items SET status='RESOLVED' WHERE id=$1`, [claim.item_id]);
      await client.query(
        `UPDATE claims SET status='REJECTED'
         WHERE item_id=$1 AND id<>$2 AND status='PENDING'`,
        [claim.item_id, claim.id]
      );

      // Claimant: get finder's contact + pickup instructions
      let claimantMsg = `🎉 Your claim on "${item.title}" was approved!`;
      claimantMsg += ` Contact ${finder.name} at ${finder.email}.`;
      if (item.pickup_location) claimantMsg += ` Pickup: ${item.pickup_location}.`;
      await client.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1,$2)`,
        [claim.claimant_id, claimantMsg]
      );

      // Finder: get claimant's contact
      let finderMsg = `✅ You approved the claim on "${item.title}". The claimant is ${claimant.name} (${claimant.email}).`;
      if (claim.contact_info) finderMsg += ` Their contact: ${claim.contact_info}.`;
      finderMsg += ` Item is now RESOLVED — please arrange handover.`;
      await client.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1,$2)`,
        [item.user_id, finderMsg]
      );
    } else {
      await client.query(
        `UPDATE items SET status='OPEN' WHERE id=$1 AND status='CLAIM_PENDING'`,
        [claim.item_id]
      );
      await client.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1,$2)`,
        [claim.claimant_id, `Your claim on "${item.title}" was rejected.`]
      );
      await client.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1,$2)`,
        [item.user_id, `You rejected a claim on your item "${item.title}". The item is available again.`]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// =====================================================
// NOTIFICATIONS
// =====================================================
router.get('/notifications', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.sub]
  );
  res.json(rows);
});

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  await pool.query(`UPDATE notifications SET read=true WHERE user_id=$1`, [req.user.sub]);
  res.json({ ok: true });
});

// =====================================================
// ADMIN STATS
// =====================================================
router.get('/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  const { rows: [stats] } = await pool.query(`
    SELECT
      (SELECT count(*) FROM users)::int                              AS users,
      (SELECT count(*) FROM items WHERE status='OPEN')::int          AS open_items,
      (SELECT count(*) FROM items WHERE status='RESOLVED')::int      AS resolved_items,
      (SELECT count(*) FROM matches)::int                            AS matches,
      (SELECT count(*) FROM claims WHERE status='PENDING')::int      AS pending_claims,
      (SELECT count(*) FROM jobs WHERE status='PENDING')::int        AS pending_jobs,
      (SELECT count(*) FROM jobs WHERE status='FAILED')::int         AS failed_jobs
  `);
  res.json(stats);
});

module.exports = router;
