'use strict';
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');

/** Returns { columns:[], rows:[[]] } from a CSV/TSV/TXT or XLSX buffer. First row = header. */
async function parseBuffer(buffer, filename) {
  if (/\.xlsx?$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow((row) => rows.push(row.values.slice(1).map(cellText)));
    const columns = (rows.shift() || []).map((c, i) => String(c || '').trim() || `Column ${i + 1}`);
    return { columns, rows: rows.filter(r => r.some(v => v !== '')).map(r => columns.map((_, i) => String(r[i] ?? '').trim())) };
  }
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const ch of first) if (ch in counts) counts[ch]++;
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
  const all = parse(text, { delimiter, relax_column_count: true, skip_empty_lines: true, trim: true });
  const columns = (all.shift() || []).map((c, i) => String(c || '').trim() || `Column ${i + 1}`);
  return { columns, rows: all.map(r => columns.map((_, i) => String(r[i] ?? '').trim())) };
}
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return v.result != null ? String(v.result) : (v.text ?? v.richText?.map(t => t.text).join('') ?? '');
  return String(v);
}
module.exports = { parseBuffer };
