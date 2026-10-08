/**
 * wizard-constants.js — all static data ported 1:1 from source index.html
 */

export const REGIONS = {
  "en-IN":{ name:"India (en-IN)",         date:"DMY", num:"indian", cur:"INR", sym:"₹",    tz:"Asia/Kolkata",       fy:"April"   },
  "en-AE":{ name:"UAE / GCC (en-AE)",     date:"DMY", num:"dot",    cur:"AED", sym:"د.إ",  tz:"Asia/Dubai",         fy:"January" },
  "en-GB":{ name:"United Kingdom (en-GB)",date:"DMY", num:"dot",    cur:"GBP", sym:"£",    tz:"Europe/London",      fy:"April"   },
  "en-US":{ name:"United States (en-US)", date:"MDY", num:"dot",    cur:"USD", sym:"$",    tz:"America/New_York",   fy:"January" },
  "de-DE":{ name:"Germany (de-DE)",       date:"DMY", num:"comma",  cur:"EUR", sym:"€",    tz:"Europe/Berlin",      fy:"January" },
  "fr-FR":{ name:"France (fr-FR)",        date:"DMY", num:"space",  cur:"EUR", sym:"€",    tz:"Europe/Paris",       fy:"January" },
  "ar-SA":{ name:"Saudi Arabia (ar-SA)",  date:"DMY", num:"dot",    cur:"SAR", sym:"﷼",   tz:"Asia/Riyadh",        fy:"January" },
  "en-SG":{ name:"Singapore (en-SG)",     date:"DMY", num:"dot",    cur:"SGD", sym:"S$",   tz:"Asia/Singapore",     fy:"January" },
  "en-AU":{ name:"Australia (en-AU)",     date:"DMY", num:"dot",    cur:"AUD", sym:"A$",   tz:"Australia/Sydney",   fy:"July"    },
  "ja-JP":{ name:"Japan (ja-JP)",         date:"YMD", num:"dot",    cur:"JPY", sym:"¥",    tz:"Asia/Tokyo",         fy:"April"   },
};

export const LANGUAGES = [
  { id:"en", name:"English"    },
  { id:"hi", name:"हिन्दी"       },
  { id:"te", name:"తెలుగు"       },
  { id:"de", name:"Deutsch"    },
  { id:"ar", name:"العربية"     },
];

export const IMPORT_TYPES_LIST = [
  { id:"stock",    label:"Opening Stock (with Supplier)" },
  { id:"item",     label:"Item Master"                   },
  { id:"supplier", label:"Supplier Master"               },
  { id:"customer", label:"Customer Master"               },
  { id:"purchase", label:"Purchase (Invtransaction)"     },
  { id:"sales",    label:"Sales (Invtransaction)"        },
];

export const BRANCHES = [
  { id:"BMS10001", name:"HYD-MAIN"         },
  { id:"BMS10002", name:"HYD-KUKATPALLY"   },
  { id:"BMS10003", name:"VJA-BENZ"         },
  { id:"BMS10004", name:"ONG-CENTRAL"      },
  { id:"BMS10005", name:"BLR-KORAMANGALA"  },
];

export const PROFILES = {
  generic:     { label:"Generic retail",                           key:["OEMCode"],               dup:"ERROR", note:"One line per OEM code. Repeated OEM = double entry." },
  apparel:     { label:"Apparel / Footwear (OEM splits into pieces)", key:["OEMCode","Size","Color"], dup:"ALLOW", note:"The same OEM / article code legitimately repeats: stock is split per piece, size or colour and each piece gets its own barcode. Only an identical line (same OEM, size, colour, qty and rate) is flagged as a possible double entry. Line identity: OEMCode+Size+Color — repeats: allowed" },
  pharma:      { label:"Pharma (batch+expiry)",                    key:["OEMCode","BatchNo"],      dup:"ERROR", note:"One line per item + batch. BatchNo and ExpiryDate are required." },
  fmcg:        { label:"Grocery / FMCG",                           key:["OEMCode","BatchNo"],      dup:"WARN",  note:"Same OEM may repeat per batch." },
  fresh:       { label:"Fresh produce / bakery",                   key:["OEMCode","PackedDate"],   dup:"ALLOW", note:"Weighed items repeat by packing date." },
  jewellery:   { label:"Jewellery",                                key:["ItemCode"],               dup:"ERROR", note:"Each piece has unique tag / ItemCode." },
  electronics: { label:"Electronics / serialised",                 key:["BatchNo"],                dup:"ERROR", note:"BatchNo holds serial / IMEI." },
};

export const SOURCE_TYPES = [
  { id:"file",   label:"Upload Excel / CSV",         desc:"Drag a file exported from Excel, Google Sheets or any system.",                           icon:"↑" },
  { id:"api",    label:"API",                         desc:"Pull records from a REST endpoint with token or key auth.",                               icon:"⇋" },
  { id:"db",     label:"Database",                    desc:"Run a query against MS SQL, MySQL, PostgreSQL, or Oracle.",                               icon:"⊡" },
  { id:"legacy", label:"Previous ERP export",         desc:"Tally, Marg, Busy, GoFrugal and others with pre-built mappings.",                         icon:"↺" },
  { id:"rc",     label:"RetailCLIQ → RetailCLIQ",    desc:"Move opening stock and masters from a running RetailCLIQ database into this one.",        icon:"⇄" },
];

export const LEGACY_SYSTEMS = ["Tally Prime","Marg ERP","Busy","Wondersoft Shoper","GoFrugal","Logic ERP","Other / generic"];

export const VALIDATION_RULES = [
  "Mandatory fields","Duplicate key (profile)","Master existence",
  "Quantity ≥ 0","Numeric format (region)","Length limits",
  "Business rules","Value / rate ≥ 0","Date format (region)",
  "HBS conversion","Expiry after As-On",
];

export const SAMPLE_TALLY = `Stock Item Name,Stock Group,Godown,Units,Closing Quantity,Closing Rate,Closing Value,Batch,Mfg Date,Expiry Date
Amul Taza Milk 500ml,Dairy,WH-HYD-01,PCS,240,26,6240,B2409A,01-09-2026,20-10-2026
Paracetamol 500mg Strip,Pharma,WH-HYD-01,STRIP,1500,9.5,14250,PCM1123,01-03-2025,31-03-2027
Britannia Bread 400g,Bakery,WH-HYD-02,PCS,60,32,1920,,,05-04-2026
Tata Salt 1kg,Grocery,WH-VJA-01,KG,120,21,2520,,,
Heritage Curd 200g,Dairy,WH-HYD-01,PCS,80,18,1440,HC0401,01-04-2026,10-04-2026`;

// Master table metadata — all 13 masters from source
export const MASTER_TABLES_META = {
  vendormaster:      { label:"Supplier",      id:"vend_uid",  name:"vend_name",   sql:"select vend_uid SupplierId, vend_name SupplierName from vendormaster where Status_id='S'" },
  CategoryMaster:    { label:"Category",      id:"CatId",     name:"CatName",     sql:"Select CatId, CatName From CategoryMaster Where Status='S'" },
  SubCategoryMaster: { label:"Sub Category",  id:"SCMId",     name:"SCMName",     sql:"select SCMId, SCMName from SubCategoryMaster where Status='S'", inferred:true },
  DivisionMaster:    { label:"Division",      id:"DivId",     name:"DivName",     sql:"select DivId, DivName from DivisionMaster where Status='S'", inferred:true },
  DepartmentMaster:  { label:"Department",    id:"SDMId",     name:"SDMName",     sql:"select SDMId, SDMName from DepartmentMaster where Status='S'", inferred:true },
  StyleMaster:       { label:"Style",         id:"StyleId",   name:"StyleName",   sql:"select StyleId, StyleName from StyleMaster where Status='S'", inferred:true },
  DesignMaster:      { label:"Design",        id:"DesId",     name:"DesName",     sql:"select DesId, DesName from DesignMaster where Status='S'", inferred:true },
  SizeMaster:        { label:"Size",          id:"SizeId",    name:"SizeOfDress", sql:"select SizeId, SizeOfDress from SizeMaster where Status='S'", inferred:true },
  ColorMaster:       { label:"Color",         id:"ColorId",   name:"ColorName",   sql:"select ColorId, ColorName from ColorMaster where Status='S'", inferred:true },
  BrandMaster:       { label:"Brand",         id:"BrandId",   name:"BrandName",   sql:"select BrandId, BrandName from BrandMaster where Status='S'", inferred:true },
  UOMMaster:         { label:"UOM",           id:"UOMId",     name:"UOMName",     sql:"Select UOMId, UOMName from UOMMaster where Status='S'" },
  Tax_Master:        { label:"Tax",           id:"Tax_uid",   name:"Tax_Desc",    sql:"select Tax_uid, Tax_per, Tax_Type_Inc_Exl from Tax_Master where Status='S'" },
  Batch:             { label:"Batch",         id:"BatchNo",   name:"BatchNo",     sql:"select distinct BatchNo from Invtransaction where Itemcode=@Itemcode", inferred:true },
};

// COL_MASTER: staging column → master table key (extended from lib/staging.js)
export const COL_MASTER_EXT = {
  Supplier:    "vendormaster",
  Category:    "CategoryMaster",
  SubCategory: "SubCategoryMaster",
  Division:    "DivisionMaster",
  Department:  "DepartmentMaster",
  Style:       "StyleMaster",
  Design:      "DesignMaster",
  Size:        "SizeMaster",
  Color:       "ColorMaster",
  Brand:       "BrandMaster",
  UOMId:       "UOMMaster",
  Tax:         "Tax_Master",
  InTax:       "Tax_Master",
  BatchNo:     "Batch",
};
