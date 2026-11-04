// Spreadsheet layout. Pure data with no browser APIs, so the Node migration
// script can import it too. Row 1 of every tab is the header; columns are
// matched by header name, so reordering columns in the sheet is safe.

export const SPREADSHEET_TITLE = 'PFBA Command Center';

// Column types drive coercion when reading (cells come back as strings,
// numbers or booleans depending on how they were entered).
//   str  — text, '' when blank (ids are always strings)
//   num  — number, 0 when blank
//   bool — true/false, accepts TRUE/1/yes
//   date — yyyy-mm-dd text, '' when blank (serial numbers are converted)
export const TABS = {
  // One row per split. A plain single-category transaction is one row; a
  // 3-way split is three rows sharing txn_id. amount is signed like the old
  // DB: negative = spend, positive = income.
  Transactions: {
    id: 'str', txn_id: 'str', date: 'date', merchant: 'str', description: 'str',
    account: 'str', is_income: 'bool', category_id: 'str', amount: 'num',
    tags: 'str', notes: 'str', created_at: 'str',
  },
  // Three kinds of rows share this tab:
  //   category   — envelope definition (name, parent_id, bucket, …)
  //   allocation — month + category_id + amount budgeted
  //   income     — month + amount of expected income
  Budget: {
    kind: 'str', id: 'str', name: 'str', parent_id: 'str', bucket: 'str',
    urgency: 'str', cap_type: 'str', icon: 'str', sort_order: 'num', archived: 'bool',
    month: 'str', category_id: 'str', amount: 'num',
  },
  Recurring: {
    id: 'str', name: 'str', amount: 'num', frequency: 'str', next_due: 'date',
    category_id: 'str', account: 'str', auto_detected: 'bool', active: 'bool',
  },
  Goals: {
    id: 'str', name: 'str', target_amount: 'num', current_amount: 'num',
    monthly_contribution: 'num', target_date: 'date', priority: 'num',
    account: 'str', why: 'str', created_at: 'str',
  },
  Settings: { key: 'str', value: 'str' },
};

// Each workout (routine) is its own tab named "Workout - <name>", holding the
// editable list of exercises for that workout.
export const WORKOUT_PREFIX = 'Workout - ';
export const WORKOUT_COLUMNS = {
  id: 'str', exercise: 'str', sets: 'num', reps: 'str', weight: 'str', notes: 'str',
};

export function columnsFor(tab) {
  if (TABS[tab]) return TABS[tab];
  if (tab.startsWith(WORKOUT_PREFIX)) return WORKOUT_COLUMNS;
  throw new Error(`Unknown tab: ${tab}`);
}

export const DEFAULT_SETTINGS = {
  split_needs: '50',
  split_investing: '30',
  split_wants: '20',
  accounts: '[]',
};

// Google Sheets date serial (days since 1899-12-30) → yyyy-mm-dd.
function serialToIso(n) {
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function coerce(type, v) {
  if (v === undefined || v === null) v = '';
  switch (type) {
    case 'num': {
      if (v === '') return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    case 'bool':
      if (typeof v === 'boolean') return v;
      return ['true', '1', 'yes'].includes(String(v).trim().toLowerCase());
    case 'date':
      if (typeof v === 'number') return serialToIso(v);
      return String(v).slice(0, 10);
    default:
      return String(v);
  }
}

// Row object → array of cell values in header order. Writes are RAW so
// text like "007" or "2026-01-05" is stored exactly as given.
export function toCells(header, obj) {
  return header.map((h) => {
    const v = obj[h];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return v;
  });
}

export function fromCells(header, cells, columns) {
  const obj = {};
  header.forEach((h, i) => {
    obj[h] = columns[h] ? coerce(columns[h], cells[i]) : (cells[i] ?? '');
  });
  for (const [k, t] of Object.entries(columns)) if (!(k in obj)) obj[k] = coerce(t, '');
  return obj;
}
