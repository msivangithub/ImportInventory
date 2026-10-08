/**
 * staging.js — shared constants and utilities for the RetailCLIQ import wizard
 * Mirrors the original index.html: STAGING_COLS, MASTER_TABLES, STD_DEFAULTS,
 * SAMPLE_STOCK, SAMPLE_SUPPLIERS, autoMatch (Levenshtein + fuzzy), resolveRow.
 */

// ── Column definitions (exact from SQL Profiler insert bulk) ─────────────────
export const COLUMN_DEFS = [
  { key:'SlNo',                 req:false, syn:['slno','sno','serial','sl','srno'] },
  { key:'ItemCode',             req:false, type:'code', identity:true, syn:['itemcode','code','itemid','productid','item','productcode','barcode'] },
  { key:'OEMCode',              req:false, type:'code', dupKey:true, identity:true, syn:['oemcode','oem','supplieritemcode','vendorcode','mfrcode','partno','articleno','article','sku','stockitem','stockitemname'] },
  { key:'ItemDescription',      req:true,  syn:['itemdescription','itemdesc','description','itemname','name','product','productname','stockitemname','desc','article','particulars'] },
  { key:'UOMId',                req:true,  master:'UOMMaster',      syn:['uomid','uom','unit','units','baseunit','measure','uomname'] },
  { key:'Qty',                  req:true,  type:'qty',  role:'qty',  syn:['qty','quantity','closingqty','closingquantity','stockqty','curqty','openingqty','nos','balance','stock','opqty','closingbalancequantity'] },
  { key:'PurchasePrice',        req:true,  type:'amount', role:'rate', syn:['purchaseprice','prate','rate','cost','costprice','purchaserate','closingrate','costrate','avgrate','landingcost','oprate','pr'] },
  { key:'MRP',                  req:false, type:'amount', role:'mrp', syn:['mrp','maxprice','listprice','maximumretailprice','retailprice','salerateinclusive'] },
  { key:'Discount',             req:false, type:'amount', syn:['discount','disvalue','disc','discamt','salediscount','discountvalue'] },
  { key:'DisType',              req:false, syn:['distype','discounttype','disctype','dtype'] },
  { key:'DiscountPrice',        req:false, type:'amount', role:'salePrice', syn:['discountprice','sstdprice','saleprice','sellingprice','sellprice','sp','stdprice','netprice'] },
  { key:'Division',             req:false, master:'DivisionMaster',  syn:['division','divname','div','divisionname'] },
  { key:'Department',           req:false, master:'DepartmentMaster',syn:['department','sdmname','dept','section','sectionname'] },
  { key:'Category',             req:true,  master:'CategoryMaster',  syn:['category','catname','group','stockgroup','itemgroup','cat','categoryname','itemcategory'] },
  { key:'SubCategory',          req:false, master:'SubCategoryMaster',syn:['subcategory','scmname','subcat','subgroup','subcategoryname'] },
  { key:'Style',                req:false, master:'StyleMaster',     syn:['style','stylename','fit','styledesign'] },
  { key:'Design',               req:false, master:'DesignMaster',    syn:['design','desname','pattern','designname'] },
  { key:'Size',                 req:false, master:'SizeMaster',      syn:['size','sizeofdress','sizes','sizeofgarment'] },
  { key:'Color',                req:false, master:'ColorMaster',     syn:['color','colour','colorname','colourname','shade'] },
  { key:'Brand',                req:false, master:'BrandMaster',     syn:['brand','brandname','manufacturer','make','company','mfr','brandcompany'] },
  { key:'Fabric',               req:false, syn:['fabric','material','cloth','fabricname'] },
  { key:'ArtName',              req:false, syn:['artname','artno','articlename','articleno','styleno'] },
  { key:'TransNo',              req:false, syn:['transno','refno','reference','docno','voucherno','grnno','invoiceno','billno'] },
  { key:'TransDate',            req:false, type:'date', role:'asOn', syn:['transdate','date','ason','asondate','openingdate','stockdate','entrydate','asofdate','openingbalancedate','effectivedate'] },
  { key:'Tokens',               req:false, syn:['tokens','token'] },
  { key:'Tax',                  req:true,  master:'Tax_Master', role:'outTax', syn:['tax','outtax','gst','gstrate','taxrate','taxper','vat','salestax','taxclass','taxcategory','gsttax','outtaxper','taxpercentage'] },
  { key:'Taxtype',              req:false, syn:['taxtype','outtaxtype','taxtypeincexl','inclusive','inclexcl','gsttype'] },
  { key:'PacketNo',             req:false, syn:['packetno','packet','packno','bale','bundle','boxno'] },
  { key:'CounterID',            req:false, master:'CounterMaster',  syn:['counterid','counter','till','countercode','pos'] },
  { key:'InTax',                req:false, master:'Tax_Master', role:'inTax', syn:['intax','purchasetax','inputtax','purchasegst','intaxper','purchasetaxrate'] },
  { key:'InTaxtype',            req:false, syn:['intaxtype','purchasetaxtype','intaxtypeincexl'] },
  { key:'Supplier',             req:true,  master:'vendormaster', syn:['supplier','suppliername','vendor','vendorname','party','partyname','vendname','vendorcode','suppliercode','supplierid'] },
  { key:'Verticle1',            req:false, role:'hsn', syn:['verticle1','hsncode','hsn','hsnsac','sac','hsnno','hsnsaccode'] },
  { key:'Verticle2',            req:false, syn:['verticle2','attribute2','season','season1'] },
  { key:'Verticle3',            req:false, syn:['verticle3','attribute3','occasion'] },
  { key:'P_Distributor_rate',   req:false, type:'amount', syn:['pdistributorrate','distributorrate','wsp','wholesaleprice','dealerprice','traderateprice'] },
  { key:'TokenType',            req:false, syn:['tokentype'] },
  { key:'PurchaseDiscount',     req:false, type:'amount', syn:['purchasediscount','purdisc','purchasedisc','purchasediscountvalue'] },
  { key:'PurchaseDiscountType', req:false, syn:['purchasediscounttype','purdisctype'] },
  { key:'BatchNo',              req:false, master:'Batch', syn:['batchno','batch','lot','lotno','batchcode','batchnumber','lotcode'] },
  { key:'PackedDate',           req:false, type:'date', syn:['packeddate','mfgdate','mfg','manufacturedate','packdate','manufacturingdate','mfdate'] },
  { key:'ExpiryDate',           req:false, type:'date', role:'expiry', syn:['expirydate','expiry','expdate','exp','bestbefore','useby','expirationdate','expirydt'] },
];

export const REQUIRED = COLUMN_DEFS.filter(c => c.req).map(c => c.key);

// Staging column → API master key (from GET /api/masters response)
export const COL_MASTER = {
  Supplier:    'vendormaster',
  Category:    'CategoryMaster',
  UOMId:       'UOMMaster',
  Tax:         'Tax_Master',
  InTax:       'Tax_Master',
};

// Master table metadata (label for UI)
export const MASTER_META = {
  vendormaster:    { label: 'Supplier',  idField: 'id', nameField: 'name' },
  CategoryMaster:  { label: 'Category', idField: 'id', nameField: 'name' },
  UOMMaster:       { label: 'UOM',      idField: 'id', nameField: 'name' },
  Tax_Master:      { label: 'Tax',      idField: 'id', nameField: 'name' },
};

// Standard defaults (mirrors STD_DEFAULTS from index.html)
export const STD_DEFAULTS = {
  DisType:               'A',
  Discount:              '0',
  PurchaseDiscount:      '0',
  PurchaseDiscountType:  'A',
  Taxtype:               'I',
  InTaxtype:             'E',
};

// ── Column transforms (mirrors TRANSFORMS from index.html) ──────────────────
export const TRANSFORMS = [
  'None','Trim','UPPERCASE','Title Case','Strip non-digits',
  'Date: force DD/MM/YYYY','Date: force MM/DD/YYYY',
  'Date: HBS int → date','Date: Excel serial → date',
  'Number: 1.234,56 → 1234.56','Multiply ×100',
];

export function applyTransform(v, t) {
  if (!t || t === 'None' || !v) return v;
  switch (t) {
    case 'Trim':                       return v.trim();
    case 'UPPERCASE':                  return v.toUpperCase();
    case 'Title Case':                 return v.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    case 'Strip non-digits':           return v.replace(/\D/g, '');
    case 'Number: 1.234,56 → 1234.56': return v.replace(/\./g, '').replace(',', '.');
    case 'Multiply ×100': { const n = parseFloat(v.replace(/,/g, '')); return isNaN(n) ? v : String(n * 100); }
    default: return v;
  }
}

// ── Auto-map scoring (exact syn = 3, contains/contained >2 chars = 1) ───────
export function smartAutoMap(columns) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cand = [];
  columns.forEach((col, i) => {
    const n = norm(col);
    COLUMN_DEFS.forEach(f => {
      const syns = [norm(f.key), ...(f.syn || [])];
      let score = 0;
      if (syns.includes(n)) score = 3;
      else if (syns.some(x => x.length > 2 && (n.includes(x) || x.includes(n)))) score = 1;
      if (score) cand.push({ i, key: f.key, score });
    });
  });
  cand.sort((a, b) => b.score - a.score);
  const usedKeys = new Set(), usedCols = new Set(), mapping = {};
  cand.forEach(({ i, key }) => {
    if (usedKeys.has(key) || usedCols.has(i)) return;
    mapping[columns[i]] = key; usedKeys.add(key); usedCols.add(i);
  });
  return mapping;
}

// ── Levenshtein similarity (0..1) — mirrors sim() from index.html ────────────
function sim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sing = x => x.replace(/(es|s)$/, '');
  if (sing(a) === sing(b)) return 0.95;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.3;
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return 1 - d[m][n] / Math.max(m, n);
}

/**
 * Auto-match a source value against a master item list (mirrors autoMatch from index.html).
 * items: [{id, name, extra?}]  — extra = Tax_per for Tax_Master
 */
export function autoMatch(val, items) {
  if (!val || !items?.length) return { mode: 'new', to: val, toId: null, via: '' };
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(val);
  const pct = n.replace(/^gst|percent|pct|%$/g, '');
  // Exact by id
  let hit = items.find(it => norm(it.id) === n);
  if (hit) return { mode: 'existing', to: hit.name, toId: hit.id, via: 'id' };
  // Exact by name
  hit = items.find(it => norm(it.name) === n);
  if (hit) return { mode: 'existing', to: hit.name, toId: hit.id, via: 'name' };
  // Extra field (e.g. tax percentage "5" → "TX05")
  hit = items.find(it => it.extra != null && (norm(String(it.extra)) === n || norm(String(it.extra)) === pct || norm('gst' + it.extra) === n));
  if (hit) return { mode: 'existing', to: hit.name, toId: hit.id, via: 'rate' };
  // Starts with / contained
  hit = items.find(it => n.length >= 3 && (norm(it.name).startsWith(n) || n.startsWith(norm(it.name))));
  if (hit) return { mode: 'existing', to: hit.name, toId: hit.id, via: 'partial' };
  // Fuzzy similarity
  let best = 0, bestItem = null;
  items.forEach(it => { const s = sim(n, norm(it.name)); if (s > best) { best = s; bestItem = it; } });
  if (best >= 0.8 && bestItem) return { mode: 'existing', to: bestItem.name, toId: bestItem.id, via: `fuzzy ${Math.round(best * 100)}%` };
  return { mode: 'new', to: val, toId: null, via: '' };
}

/**
 * Resolve one raw file row into a staging object (mirrors resolvedRow from index.html).
 * Applies: column mapping → transforms → supplier resolution → master resolution → STD_DEFAULTS
 */
export function resolveRow(rawRow, columns, columnMapping, transforms, suppliersResolution, masterResolution, applyDefaultsFlag, rowIdx) {
  const obj = {};
  columns.forEach((col, i) => {
    const stagingCol = columnMapping[col];
    if (!stagingCol) return;
    let val = (rawRow[i] || '').trim();
    const tr = transforms?.[col];
    if (tr && tr !== 'None') val = applyTransform(val, tr);
    if (stagingCol === 'Supplier' && suppliersResolution && suppliersResolution[val] !== undefined) {
      val = suppliersResolution[val];
    } else if (masterResolution?.[stagingCol]?.[val] !== undefined) {
      val = masterResolution[stagingCol][val];
    }
    obj[stagingCol] = val;
  });
  if (applyDefaultsFlag !== false) {
    if (!obj['SlNo']) obj['SlNo'] = String(rowIdx + 1);
    Object.entries(STD_DEFAULTS).forEach(([k, v]) => { if (!obj[k]) obj[k] = v; });
  }
  return obj;
}

// ── Sample data (mirrors SAMPLE_STOCK from index.html) ──────────────────────
export const SAMPLE_STOCK = `SlNo,OEMCode,ItemDescription,UOM,Qty,PurchasePrice,MRP,Discount,DisType,Category,SubCategory,Brand,Size,Color,HSNCODE,InTax,InTaxtype,OutTax,OutTaxtype,SupplierName,BatchNo,ExpiryDate,TransDate
1,RAY-SH-1001,RAYMOND FORMAL SHIRT WHITE,PCS,24,899.00,1499.00,10,P,APPAREL,SHIRTS,RAYMOND,M,WHITE,62052000,5,E,5,I,Raymond Apparel,,,01/04/2026
2,RAY-SH-1002,RAYMOND FORMAL SHIRT BLUE,PCS,18,899.00,1499.00,10,P,APPAREL,SHIRTS,RAYMOND,L,BLUE,62052000,5,E,5,I,Raymond Apparel,,,01/04/2026
3,AMUL-TM-500,AMUL TAZA MILK 500ML,PCS,240,26.00,28.00,0,A,DAIRY,MILK,AMUL,,,04011000,0,E,0,I,Heritage Foods,B2409A,20/10/2026,01/04/2026
4,CIP-PCM-500,PARACETAMOL 500MG STRIP,STRIP,1500,9.50,14.00,0,A,PHARMA,TABLETS,CIPLA,,,30049099,12,E,12,I,Medplus Distributors,PCM1123,31/03/2027,01/04/2026
5,BRIT-BR-400,BRITANNIA BREAD 400G,PCS,60,32.00,40.00,0,A,BAKERY,BREAD,BRITANNIA,,,19052000,0,E,0,I,Metro Cash & Carry,,05/04/2026,01/04/2026
6,TATA-SALT-1,TATA SALT 1KG,KG,120,21.00,25.00,0,A,GROCERY,,TATA,,,25010020,0,E,0,I,Sri Lakshmi Traders,,,01/04/2026
7,HER-CURD-200,HERITAGE CURD 200G,Pcs,80,18.00,20.00,0,A,DAIRY,,HERITAGE,,,04031000,0,E,0,I,Heritage Foods,HC0401,10/04/2026,01/04/2026
8,RAY-SH-1001,RAYMOND FORMAL SHIRT WHITE,PCS,24,899.00,1499.00,10,P,APPAREL,SHIRTS,RAYMOND,M,WHITE,62052000,5,E,5,I,Raymond Apparel,,,01/04/2026
9,LAYS-CL-52,LAYS CLASSIC 52G,PKT,,15.00,20.00,0,A,GROCERY,,PEPSICO,,,19059030,12,E,12,I,Metro Cash & Carry,,30/06/2026,01/04/2026
10,CG-ST-100,COLGATE STRONG 100G,PCS,200,52.00,60.00,0,A,HOUSEHOLD,,COLGATE,,,33061020,18,E,18,I,Metro Cash & Carry,CG1177,31/08/2027,01/04/2026
11,SURF-1KG,SURF EXCEL 1KG,KG,-12,145.00,160.00,0,A,HOUSEHOLD,,HUL,,,34022010,18,E,18,I,Sri Lakshmi Traders,,,01/04/2026
12,CIP-AZ-500,CIPLA AZITHRO 500 TAB,STRIP,300,42.00,68.00,0,A,PHARMA,TABLETS,CIPLA,,,30042099,12,E,12,I,Medplus Distributors,AZ2210,31/02/2026,01/04/2026
13,SAR-KAN-01,KANCHIPURAM SILK SAREE,PCS,6,4200.00,6999.00,5,P,APPAREL,SAREES,GENERIC,FREE,RED,50071000,5,E,5,I,Raymond Apparel,,,01/04/2026
14,AMUL-BT-500,AMUL BUTTER 500G,PCS,24,245.00,275.00,0,A,DAIRY,,AMUL,,,04051000,12,E,12,I,Heritage Foods,AB0322,31/12/2025,01/04/2026
15,MAGGI-70,NESTLE MAGGI 70G,PKT,360,12.50,14.00,0,A,GROCERY,,NESTLE,,,19023010,18,E,18,I,Sri Lakshmi Traders,,15/11/2026,01/04/2026
16,,UNKNOWN LINE ITEM,PCS,10,1.00,1.00,0,A,GROCERY,,GENERIC,,,,0,E,0,I,Sri Lakshmi Traders,,,01/04/2026
17,DAW-BAS-5,DAAWAT BASMATI 5KG,BAG,30,620.00,699.00,0,A,GROCERY,,DAAWAT,,,10063020,5,E,5,I,Sri Lakshmi Traders,,,01/04/2026
18,RAY-TR-2001,RAYMOND TROUSER GREY,PCS,12,1250.00,1999.00,15,P,APPAREL,TROUSERS,RAYMOND,34,GREY,62034200,5,E,5,I,Raymond Apparel,,,01-04-2026`;

// ── Supplier file sample (mirrors SAMPLE_SUPPLIERS from index.html) ──────────
export const SAMPLE_SUPPLIERS = `Supplier Name,Supplier Code,GSTIN,PAN,Mobile,Email,City,State,PIN,Credit Days,Opening Outstanding,Dr/Cr,As On
Raymond Apparel,V10005,36AAACR4849R1ZK,AAACR4849R,9848012345,accounts@raymondapparel.in,Hyderabad,Telangana,500081,45,"1,25,400.00",Cr,01/04/2026
Sri Lakshmi Traders,V10001,37AABCS1234A1Z2,AABCS1234A,9876543210,sales@srilakshmi.co.in,Ongole,Andhra Pradesh,523001,30,"42,350.50",Cr,01/04/2026
Heritage Foods,V10004,36AAACH1234B1Z9,AAACH1234B,9000011111,dist@heritagefoods.in,Hyderabad,Telangana,500032,15,0,Cr,01/04/2026
Metro Cash & Carry,V10002,36AAACM1234C1Z7,AAACM1234C,9000022222,b2b@metro.co.in,Hyderabad,Telangana,500084,7,"8,900.00",Dr,01/04/2026
Medplus Distributors,,36AAACM9876D1Z1,AAACM9876D,9000033333,,Hyderabad,Telangana,500016,21,"17,250.00",Cr,01/04/2026`;

// Supplier file field definitions (mirrors SUP_FIELDS from index.html)
export const SUP_FIELDS = [
  ['vend_name','Supplier Name *',  ['suppliername','supplier','vendorname','vendor','name','partyname','party','vendname']],
  ['vend_uid', 'Supplier Code',    ['suppliercode','code','vendorcode','venduid','supplierid','id']],
  ['GSTIN',    'GSTIN',            ['gstin','gstno','gst','gstnumber']],
  ['PAN',      'PAN',              ['pan','panno']],
  ['Mobile',   'Mobile',           ['mobile','phone','contact','mobileno','cell']],
  ['Email',    'Email',            ['email','mail','emailid']],
  ['City',     'City',             ['city','town']],
  ['State',    'State',            ['state']],
  ['PIN',      'PIN',              ['pin','pincode','zip','postalcode']],
  ['Credit_Days','Credit Days',    ['creditdays','paymentdays','terms','creditperiod']],
  ['Outstanding','Opening Outstanding',['openingoutstanding','outstanding','openingbalance','balance','obamount','amount']],
  ['DrCr',     'Dr/Cr',            ['drcr','crdr','type','balancetype','nature']],
  ['AsOn',     'As On',            ['ason','asondate','date','obdate']],
];

export function supAutoMap(columns) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapping = {}, used = new Set();
  columns.forEach((col, i) => {
    const n = norm(col);
    const f = SUP_FIELDS.find(([k, l, syn]) => !used.has(k) && (syn.includes(n) || norm(l) === n));
    if (f) { mapping[i] = f[0]; used.add(f[0]); }
  });
  return mapping;
}

// Parse a CSV string → {columns, rows}
export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return { columns: [], rows: [] };
  const detect = t => { const l = t.split('\n')[0] || ''; const c = {',':0,';':0,'\t':0,'|':0}; for (const ch of l) if (ch in c) c[ch]++; return Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0]||','; };
  const delim = detect(text);
  const parse = (t, d) => { const rows = []; let row = [], cell = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; } else { if (ch === '"') q = true; else if (ch === d) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch; } } if (cell.length || row.length) { row.push(cell); rows.push(row); } return rows.filter(r => r.some(c => c.trim() !== '')); };
  const all = parse(text, delim);
  if (!all.length) return { columns: [], rows: [] };
  const columns = all[0].map((c, i) => c.trim() || `Col${i+1}`);
  const rows = all.slice(1).map(r => columns.map((_, i) => (r[i] || '').trim()));
  return { columns, rows };
}
