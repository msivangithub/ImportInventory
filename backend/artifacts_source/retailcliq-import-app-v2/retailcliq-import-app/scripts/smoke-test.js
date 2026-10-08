'use strict';
/* End-to-end smoke test of the framework on DB_NEW with 3 staging rows: begin → bulk → validate → post → status → rollback. */
require('dotenv').config();
const { sql, pool } = require('../server/lib/db');
(async () => {
  const p = await pool('new');
  const b = await p.request().input('ImportType', 'STOCK').input('CompId', process.env.COMP_ID || 'C001').input('BranchId', process.argv[2] || 'BMS10001').input('UserId', 'U10001')
    .input('SourceName', 'smoke-test').input('PostMode', process.env.POST_MODE || 'LEGACY').input('PurchaseAccount', process.argv[3] || null).input('DupKeyColumns', 'OEMCode,Size,Color').input('DupMode', 'ALLOW').input('DbMode', 'FRESH').input('ChunkSize', 2)
    .output('BatchId', sql.VarChar(30)).execute('proc_Import_Begin');
  const batchId = b.output.BatchId; console.log('batch', batchId);
  const rows = [
    { OEMCode: 'SMOKE-001', ItemDescription: 'SMOKE TEST SHIRT M', UOMId: 'PCS', Qty: '2', PurchasePrice: '100', MRP: '150', Category: 'APPAREL', Size: 'M', Color: 'WHITE', Supplier: 'SMOKE SUPPLIER', Tax: '5', Taxtype: 'I', InTax: '5', InTaxtype: 'E', TransDate: '01/04/2026', DisType: 'A', Discount: '0' },
    { OEMCode: 'SMOKE-001', ItemDescription: 'SMOKE TEST SHIRT L', UOMId: 'PCS', Qty: '3', PurchasePrice: '100', MRP: '150', Category: 'APPAREL', Size: 'L', Color: 'WHITE', Supplier: 'SMOKE SUPPLIER', Tax: '5', Taxtype: 'I', InTax: '5', InTaxtype: 'E', TransDate: '01/04/2026', DisType: 'A', Discount: '0' },
    { OEMCode: 'SMOKE-002', ItemDescription: 'SMOKE TEST BAD ROW', UOMId: 'PCS', Qty: '-1', PurchasePrice: '100', MRP: '150', Category: 'APPAREL', Supplier: 'SMOKE SUPPLIER', Tax: '5', TransDate: '31/02/2026' },
  ];
  const t = new sql.Table('dbo.Stock_Import_Export'); t.create = false;
  const cols = Object.keys(rows[0]); cols.forEach(c => t.columns.add(c, sql.VarChar(200), { nullable: true }));
  t.columns.add('BatchId', sql.VarChar(30), { nullable: true }); t.columns.add('RowNo', sql.Int, { nullable: true }); t.columns.add('RowStatus', sql.Char(1), { nullable: false });
  rows.forEach((r, i) => t.rows.add(...cols.map(c => r[c] ?? ''), batchId, i + 1, 'P'));
  await p.request().bulk(t); console.log('staged 3 rows');
  const v = await p.request().input('BatchId', batchId).execute('proc_Import_Validate'); console.log('validate:', v.recordset[0]);
  const g = await p.request().input('BatchId', batchId).input('AllowErrors', 1).execute('proc_Import_Gate');
  console.table(g.recordsets[0]); console.log('gate:', g.recordsets[1][0]);
  if (process.argv.includes('--post')) {
    const r = await p.request().input('BatchId', batchId).input('MaxChunks', null).execute('proc_Import_Post'); console.log('post:', r.recordsets[0][0].Status, r.recordsets[1].map(c => `${c.ChunkNo}:${c.Status}`).join(' '));
    const rb = await p.request().input('BatchId', batchId).input('UserId', 'U10001').input('Reason', 'smoke rollback').input('FromChunk', 1).execute('proc_Import_Rollback'); console.log('rollback:', rb.recordsets[0][0].Status);
  } else console.log('(add --post <BranchId> <PurchaseAccount> to also post and roll back)');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
