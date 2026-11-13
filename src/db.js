const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Add it to .env or your host environment.');
  process.exit(1);
}

const needsSSL = process.env.DATABASE_URL.includes('render.com') ||
                 process.env.DATABASE_URL.includes('sslmode=require');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('unexpected db error', err.message));

module.exports = pool;
