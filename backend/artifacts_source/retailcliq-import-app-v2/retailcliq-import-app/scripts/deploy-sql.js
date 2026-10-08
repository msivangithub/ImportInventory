'use strict';
/* Runs a .sql file against DB_NEW, splitting on GO batches (like SSMS). Usage: node scripts/deploy-sql.js sql/01_batch_framework.sql */
require('dotenv').config();
const fs = require('fs');
const { pool } = require('../server/lib/db');
(async () => {
  const file = process.argv[2]; if (!file) { console.error('usage: node scripts/deploy-sql.js <file.sql>'); process.exit(1); }
  const text = fs.readFileSync(file, 'utf8').replace(/^USE \[.*?\];?\s*$/gm, '');   // always the configured DB_NEW
  const batches = text.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(Boolean);
  const p = await pool('new'); let n = 0;
  for (const b of batches) { try { await p.request().batch(b); n++; } catch (e) { console.error(`\n--- batch ${n + 1} failed ---\n${b.slice(0, 300)}\n→ ${e.message}`); process.exit(1); } }
  console.log(`✓ ${n} batches executed on ${process.env.DB_NEW}`);
  const r = await p.request().query("select name from sys.procedures where name like 'proc_Import_%' order by name");
  console.log('procs:', r.recordset.map(x => x.name).join(', '));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
