const mysql = require('mysql2/promise');
require('dotenv').config();

// Verify required env vars at startup so the error is OBVIOUS in logs
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter((k) => !process.env[k] || process.env[k] === '');
if (missing.length > 0) {
  console.error('[db] FATAL: Missing required env vars: ' + missing.join(', '));
  console.error('[db] Please set them in your hosting dashboard (Wasmer / Hostinger / etc).');
  // Do NOT exit -- let HTTP server boot so /health endpoint works.
  // Each DB query will simply fail with a clear error message.
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4_unicode_ci',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 15000,
});

// Pool-level error handler -- prevents MySQL errors from killing the app
pool.on('error', (err) => {
  console.error('[db] pool error (caught, not fatal):', err.code || err.message);
});

module.exports = pool;