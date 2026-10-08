// HBS date engine — mirrors dbo.englishHBS / dbo.ConvertHBSDate in SQL Server
// (year-1950)*416 + month*32 + day
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function hbsToInt(date) {
  const d = date instanceof Date ? date : new Date(date + 'T00:00:00Z');
  if (isNaN(d)) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  if (y < 1950) return null;
  return (y - 1950) * 416 + m * 32 + day;
}

export function hbsFromInt(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 32) return null;
  const y = Math.floor(n / 416) + 1950;
  const m = Math.floor((n % 416) / 32);
  const d = (n % 416) % 32;
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export function hbsDisplay(n) {
  const d = hbsFromInt(n);
  if (!d) return '';
  return `${String(d.getUTCDate()).padStart(2,'0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export function isHbsInt(s) {
  const n = Number(String(s).trim());
  if (!Number.isInteger(n) || n < 33 || n > 99999) return false;
  const d = hbsFromInt(n);
  if (!d) return false;
  const y = d.getUTCFullYear();
  return y >= 1980 && y <= 2099;
}

const NORM_DATE = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/;
export function parseImportDate(s, order = 'DMY') {
  if (!s) return null;
  s = String(s).trim();
  if (!s) return null;
  // Already HBS integer
  if (/^\d{4,5}$/.test(s) && isHbsInt(s)) return hbsFromInt(Number(s));
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0,10) + 'T00:00:00Z');
  // dd-Mon-yyyy
  const dm = s.match(/^(\d{1,2})[-\/\. ]([A-Za-z]{3,9})[-\/\. ](\d{2,4})$/);
  if (dm) {
    const mi = MON.findIndex(x => dm[2].toLowerCase().startsWith(x.toLowerCase()));
    let y = parseInt(dm[3]); if (y < 100) y += 2000;
    if (mi >= 0) return new Date(Date.UTC(y, mi, parseInt(dm[1])));
  }
  const m = s.replace(/[\.]/g, '/').match(NORM_DATE);
  if (!m) return null;
  let [, a, b, c] = m;
  let y = parseInt(c); if (y < 100) y += 2000;
  if (order === 'MDY') return new Date(Date.UTC(y, parseInt(a)-1, parseInt(b)));
  if (order === 'YMD') return new Date(Date.UTC(parseInt(a), parseInt(b)-1, parseInt(c)));
  return new Date(Date.UTC(y, parseInt(b)-1, parseInt(a)));
}
