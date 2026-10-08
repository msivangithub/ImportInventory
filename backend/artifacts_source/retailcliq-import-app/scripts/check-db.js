'use strict';
/* Verifies connectivity and which objects the import depends on exist in DB_NEW / DB_OLD, and prints the VERIFY column answers. */
require('dotenv').config();
const { query } = require('../server/lib/db');
const need = ['Itemmaster','Price_Master','Invtransaction','Itemproperties','Stock_Import_Export','vendormaster','Tax_Master','CategoryMaster','UOMMaster','M_GeneralLedger','CounterMaster','BranchMaster','DivisionMaster','DepartmentMaster','SubCategoryMaster','StyleMaster','DesignMaster','SizeMaster','ColorMaster','BrandMaster','proc_StockImportwithSupplier','sp_englishHBS','ConvertHBSDate','englishHBS','ImportBatch','proc_Import_Post'];
(async () => {
  for (const which of ['new', 'old']) {
    const db = which === 'new' ? process.env.DB_NEW : process.env.DB_OLD;
    console.log(`\n=== ${which.toUpperCase()}: ${db} ===`);
    try {
      const v = await query(which, 'select @@version as v'); console.log(v.recordset[0].v.split('\n')[0]);
      const r = await query(which, `select name, type_desc from sys.objects where name in (${need.map(n => `'${n}'`).join(',')})`);
      const have = new Map(r.recordset.map(x => [x.name.toLowerCase(), x.type_desc]));
      for (const n of need) console.log(`  ${have.has(n.toLowerCase()) ? '✓' : '✗'} ${n}${have.has(n.toLowerCase()) ? '  (' + have.get(n.toLowerCase()) + ')' : ''}`);
      if (which === 'new') {
        for (const t of ['Invtransaction', 'Itemmaster', 'Price_Master', 'vendormaster', 'M_GeneralLedger', 'Stock_Import_Export']) {
          const c = await query(which, `select c.name, t.name as ty, c.max_length from sys.columns c join sys.types t on t.user_type_id=c.user_type_id where c.object_id=object_id('dbo.${t}') order by c.column_id`);
          console.log(`\n  ${t} (${c.recordset.length} cols): ${c.recordset.map(x => `${x.name}:${x.ty}`).join(', ')}`);
        }
        const cnt = await query(which, "select (select count(*) from Itemmaster) as items, (select count(*) from vendormaster) as vendors, (select count(*) from Invtransaction) as inv");
        console.log('\n  counts:', cnt.recordset[0]);
      } else {
        const cnt = await query(which, "select count(*) as items, sum(case when CurQty<>0 then 1 else 0 end) as withStock from Itemproperties");
        console.log('  Itemproperties:', cnt.recordset[0]);
      }
    } catch (e) { console.log('  ✗ ' + e.message); }
  }
  process.exit(0);
})();
