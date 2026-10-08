'use strict';
const sql = require('mssql');
require('dotenv').config();

const base = {
  server: process.env.SQL_SERVER,
  port: Number(process.env.SQL_PORT || 1433),
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    encrypt: String(process.env.SQL_ENCRYPT || 'false') === 'true',
    trustServerCertificate: String(process.env.SQL_TRUST_CERT || 'true') === 'true',
    enableArithAbort: true,
    requestTimeout: 10 * 60 * 1000,   // long-running procs (post / rollback)
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const pools = {};
async function pool(which = 'new') {
  const database = which === 'old' ? process.env.DB_OLD : process.env.DB_NEW;
  if (!database) throw new Error(`DB_${which.toUpperCase()} is not set in .env`);
  if (!pools[which]) {
    pools[which] = new sql.ConnectionPool({ ...base, database }).connect();
    pools[which].catch(() => { delete pools[which]; });
  }
  return pools[which];
}
async function query(which, text, params = {}) {
  const p = await pool(which);
  const r = p.request();
  for (const [k, v] of Object.entries(params)) r.input(k, v);
  return r.query(text);
}
module.exports = { sql, pool, query };
