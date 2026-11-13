require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const pool = require('./db');
const routes = require('./routes');
const { startWorker } = require('./worker');

const app = express();

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check — used by Render + the report's fault-tolerance demo
app.get('/api/health', async (_req, res) => {
  try {
    const { rows: [{ now }] } = await pool.query('SELECT now()');
    res.json({ status: 'ok', db: 'connected', time: now });
  } catch (e) {
    res.status(503).json({ status: 'degraded', error: e.message });
  }
});

app.use('/api', routes);

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('unhandled:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API listening on http://localhost:${PORT}`));

// Run the matching worker in-process by default (Render free tier friendly).
if (process.env.RUN_WORKER !== 'false') startWorker();
