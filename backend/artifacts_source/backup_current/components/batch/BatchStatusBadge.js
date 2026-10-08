const STATUS = {
  Staging:    'bg-slate-100 text-slate-700 border-slate-300',
  Validated:  'bg-blue-50 text-blue-700 border-blue-200',
  Posting:    'bg-amber-50 text-amber-800 border-amber-300 animate-pulse',
  Posted:     'bg-emerald-50 text-emerald-700 border-emerald-300',
  Reconciled: 'bg-emerald-100 text-emerald-800 border-emerald-400',
  Failed:     'bg-rose-50 text-rose-700 border-rose-300',
  Cancelled:  'bg-slate-100 text-slate-600 border-slate-200',
  RolledBack: 'bg-orange-50 text-orange-700 border-orange-300',
  Pending:    'bg-slate-100 text-slate-500 border-slate-200',
  Committed:  'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export const RESULT = {
  PASS:   'bg-emerald-100 text-emerald-800 border-emerald-300',
  FAIL:   'bg-rose-100 text-rose-800 border-rose-300',
  WARN:   'bg-amber-100 text-amber-800 border-amber-300',
  PHASE2: 'bg-purple-100 text-purple-800 border-purple-300',
};

export default function BatchStatusBadge({ status, className = '' }) {
  const cls = STATUS[status] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls} ${className}`}
          data-testid={`status-badge-${status}`}>
      {status}
    </span>
  );
}

export function ResultBadge({ result }) {
  const cls = RESULT[result] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      {result}
    </span>
  );
}
