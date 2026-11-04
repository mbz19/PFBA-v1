// Finance domain logic on top of sheets.js — the client-side replacement for
// the old Express routes (budget, transactions, categories, recurring, goals).
import * as sheets from './sheets.js';
import { monthlyEquivalent, detectRecurring } from './recurring.js';
import { isoDate } from './format.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Categories (Budget tab, kind=category)
// ---------------------------------------------------------------------------
export function categories() {
  const cats = sheets.rows('Budget').filter((r) => r.kind === 'category' && !r.archived);
  // Same order as the old SQL: parents by sort_order, each followed by its children.
  const parents = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const out = [];
  for (const p of parents) {
    out.push(p);
    out.push(...cats.filter((c) => c.parent_id === p.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
  }
  // Orphans (parent archived/missing) still show up.
  for (const c of cats) if (!out.includes(c)) out.push(c);
  return out;
}

export function addCategory({ name, parent_id, bucket, urgency, cap_type, icon }) {
  const siblings = categories().filter((c) => (c.parent_id || '') === (parent_id || ''));
  const sort_order = siblings.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1;
  return sheets.insert('Budget', {
    kind: 'category', name, parent_id: parent_id || '', bucket,
    urgency: urgency || '', cap_type: cap_type || 'soft', icon: icon || 'Circle',
    sort_order, archived: false,
  });
}

export function updateCategory(id, patch) {
  const clean = { ...patch };
  if ('parent_id' in clean) clean.parent_id = clean.parent_id || '';
  if ('urgency' in clean) clean.urgency = clean.urgency || '';
  sheets.update('Budget', id, clean);
}

// Archive (soft delete) a category and its children to preserve history.
export function archiveCategory(id) {
  const t = sheets.rows('Budget');
  for (const r of t) {
    if (r.kind === 'category' && (r.id === id || r.parent_id === id)) sheets.update('Budget', r.id, { archived: true });
  }
}

// ---------------------------------------------------------------------------
// Transactions (one sheet row per split, grouped by txn_id)
// ---------------------------------------------------------------------------
export function transactions({ month } = {}) {
  const groups = new Map();
  for (const r of sheets.rows('Transactions')) {
    const key = r.txn_id || r.id;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key, date: r.date, merchant: r.merchant, description: r.description,
        account: r.account, is_income: r.is_income, notes: r.notes, created_at: r.created_at,
        tags: r.tags ? r.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
        amount: 0, splits: [],
      });
    }
    const g = groups.get(key);
    g.amount = round2(g.amount + r.amount);
    g.splits.push({ id: r.id, category_id: r.category_id || null, amount: r.amount });
  }
  let list = [...groups.values()];
  if (month) list = list.filter((t) => String(t.date).slice(0, 7) === month);
  return list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : (b.created_at > a.created_at ? 1 : -1)));
}

// payload: { date, amount, merchant, description, account, notes, is_income,
//            category_id?, splits?: [{category_id, amount}], tags: string[] }
export function saveTransaction(payload, existingId) {
  const sign = payload.is_income ? 1 : -1;
  const splits = Array.isArray(payload.splits) && payload.splits.length
    ? payload.splits
    : [{ category_id: payload.category_id ?? null, amount: payload.amount }];
  const txnId = existingId || sheets.newId();
  const prior = existingId ? sheets.rows('Transactions').find((r) => (r.txn_id || r.id) === existingId) : null;
  if (existingId) sheets.removeWhere('Transactions', (r) => (r.txn_id || r.id) === existingId);
  sheets.insertMany('Transactions', splits.map((s) => ({
    txn_id: txnId,
    date: payload.date || isoDate(),
    merchant: payload.merchant || '',
    description: payload.description || '',
    account: payload.account || '',
    is_income: !!payload.is_income,
    category_id: s.category_id || '',
    amount: sign * Math.abs(Number(s.amount) || 0),
    tags: (payload.tags || []).join(', '),
    notes: payload.notes || '',
    created_at: prior?.created_at || new Date().toISOString(),
  })));
  return txnId;
}

export const deleteTransaction = (id) =>
  sheets.removeWhere('Transactions', (r) => (r.txn_id || r.id) === id);

// ---------------------------------------------------------------------------
// Budget for a month — ported from server/routes/budget.js
// ---------------------------------------------------------------------------
export function splitPct() {
  const s = sheets.settings();
  return {
    needs: Number(s.split_needs ?? 50),
    investing: Number(s.split_investing ?? 30),
    wants: Number(s.split_wants ?? 20),
  };
}

export function setSplitPct(next) {
  sheets.setSetting('split_needs', String(next.needs));
  sheets.setSetting('split_investing', String(next.investing));
  sheets.setSetting('split_wants', String(next.wants));
}

export function setAllocation(year, month, categoryId, amount) {
  const ym = monthKey(year, month);
  const row = sheets.rows('Budget').find((r) => r.kind === 'allocation' && r.month === ym && r.category_id === categoryId);
  if (row) sheets.update('Budget', row.id, { amount: Number(amount) || 0 });
  else sheets.insert('Budget', { kind: 'allocation', month: ym, category_id: categoryId, amount: Number(amount) || 0 });
}

export function setExpectedIncome(year, month, amount) {
  const ym = monthKey(year, month);
  const row = sheets.rows('Budget').find((r) => r.kind === 'income' && r.month === ym);
  if (row) sheets.update('Budget', row.id, { amount: Number(amount) || 0 });
  else sheets.insert('Budget', { kind: 'income', month: ym, amount: Number(amount) || 0 });
}

export function computeBudget(year, month) {
  const ym = monthKey(year, month);
  const cats = categories();
  const budgetRows = sheets.rows('Budget');

  const allocByCat = {};
  for (const r of budgetRows) if (r.kind === 'allocation' && r.month === ym) allocByCat[r.category_id] = r.amount;

  // Actual outflow per category this month (spend is stored negative).
  const monthRows = sheets.rows('Transactions').filter((r) => String(r.date).slice(0, 7) === ym);
  const actualByCat = {};
  for (const r of monthRows) {
    if (r.amount < 0) actualByCat[r.category_id || ''] = (actualByCat[r.category_id || ''] || 0) - r.amount;
  }

  const childrenOf = {};
  for (const c of cats) if (c.parent_id) (childrenOf[c.parent_id] ||= []).push(c.id);

  const enriched = cats.map((c) => {
    const budgeted = allocByCat[c.id] || 0;
    let actual = actualByCat[c.id] || 0;
    let budgetedRollup = budgeted;
    if (childrenOf[c.id]) {
      for (const kid of childrenOf[c.id]) {
        actual += actualByCat[kid] || 0;
        budgetedRollup += allocByCat[kid] || 0;
      }
    }
    const isParent = !c.parent_id && childrenOf[c.id];
    const effBudget = isParent ? budgetedRollup : budgeted;
    return {
      ...c,
      budgeted: effBudget,
      ownBudgeted: budgeted,
      actual,
      remaining: effBudget - actual,
      overCap: actual > effBudget && effBudget > 0,
      pctUsed: effBudget > 0 ? actual / effBudget : actual > 0 ? 1 : 0,
    };
  });

  // Expected income (editable). Fall back to actual income this month.
  const expectedIncome = budgetRows.find((r) => r.kind === 'income' && r.month === ym)?.amount || 0;
  const actualIncome = round2(monthRows.filter((r) => r.is_income).reduce((s, r) => s + r.amount, 0));
  const incomeBase = expectedIncome > 0 ? expectedIncome : actualIncome;

  // Bucket rollups (leaf categories only to avoid double-counting).
  const buckets = { needs: { budgeted: 0, actual: 0 }, wants: { budgeted: 0, actual: 0 }, investing: { budgeted: 0, actual: 0 } };
  for (const c of enriched) {
    const isLeaf = c.parent_id || !childrenOf[c.id];
    if (isLeaf && buckets[c.bucket]) {
      buckets[c.bucket].budgeted += c.ownBudgeted;
      buckets[c.bucket].actual += actualByCat[c.id] || 0;
    }
  }
  const pct = splitPct();
  for (const b of Object.keys(buckets)) {
    buckets[b].targetPct = pct[b];
    buckets[b].targetAmount = round2((pct[b] / 100) * incomeBase);
  }

  const totalBudgeted = Object.values(buckets).reduce((s, b) => s + b.budgeted, 0);
  const totalActual = Object.values(buckets).reduce((s, b) => s + b.actual, 0);

  // Committed recurring costs feed a fuller safe-to-spend.
  const recurring = recurringItems();
  const committedRecurring = round2(recurring.reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0));
  // Recurring whose category isn't budgeted this month isn't captured by the
  // envelope obligations below, so it's subtracted separately (no double-count).
  const committedRecurringUnbudgeted = round2(
    recurring
      .filter((r) => !r.category_id || !(r.category_id in allocByCat))
      .reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0)
  );

  // Money still assigned to envelopes but not yet spent (leaf categories only).
  let remainingObligations = 0;
  for (const c of enriched) {
    const isLeaf = c.parent_id || !childrenOf[c.id];
    if (isLeaf) remainingObligations += Math.max(0, c.ownBudgeted - (actualByCat[c.id] || 0));
  }
  remainingObligations = round2(remainingObligations);

  return {
    year, month,
    splitPct: pct,
    expectedIncome,
    actualIncome,
    incomeBase,
    categories: enriched,
    buckets,
    totalBudgeted,
    totalActual,
    leftToBudget: round2(incomeBase - totalBudgeted),
    safeToSpend: round2(incomeBase - totalActual),
    committedRecurring,
    remainingObligations,
    // income − spent − reserved envelopes − unbudgeted commitments
    safeToSpendCommitted: round2(incomeBase - totalActual - remainingObligations - committedRecurringUnbudgeted),
  };
}

// ---------------------------------------------------------------------------
// Recurring
// ---------------------------------------------------------------------------
export function recurringItems() {
  return sheets.rows('Recurring')
    .filter((r) => r.active)
    .sort((a, b) => (!a.next_due) - (!b.next_due) || String(a.next_due).localeCompare(String(b.next_due)));
}

export function saveRecurring(payload, id) {
  const row = {
    name: payload.name, amount: Number(payload.amount) || 0, frequency: payload.frequency || 'monthly',
    next_due: payload.next_due || '', category_id: payload.category_id || '', account: payload.account || '',
  };
  if (id) sheets.update('Recurring', id, row);
  else sheets.insert('Recurring', { ...row, auto_detected: !!payload.auto_detected, active: true });
}

export const deleteRecurring = (id) => sheets.remove('Recurring', id);

// Suggestions from transaction history, excluding names already tracked.
export function recurringSuggestions() {
  const txns = transactions()
    .filter((t) => !t.is_income)
    .map((t) => ({ date: t.date, amount: t.amount, merchant: t.merchant, is_income: false, category_id: t.splits[0]?.category_id || null }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const existing = new Set(sheets.rows('Recurring').map((r) => r.name.toLowerCase()));
  return detectRecurring(txns).filter((s) => !existing.has((s.name || '').toLowerCase()));
}

// ---------------------------------------------------------------------------
// Goals — projection ported from server/routes/goals.js
// ---------------------------------------------------------------------------
function project(g) {
  const remaining = Math.max(0, g.target_amount - g.current_amount);
  const progress = g.target_amount > 0 ? Math.min(1, g.current_amount / g.target_amount) : 0;
  let monthsToComplete = null, projectedDate = null, onTrack = null;
  if (remaining <= 0) {
    monthsToComplete = 0;
  } else if (g.monthly_contribution > 0) {
    monthsToComplete = Math.ceil(remaining / g.monthly_contribution);
    const d = new Date();
    d.setMonth(d.getMonth() + monthsToComplete);
    projectedDate = isoDate(d);
    // On track if projected completion is on/before the target date.
    if (g.target_date) onTrack = projectedDate <= g.target_date;
  }
  return { ...g, remaining: round2(remaining), progress, monthsToComplete, projectedDate, onTrack };
}

export function goals() {
  return sheets.rows('Goals')
    .slice()
    .sort((a, b) => b.priority - a.priority || (!a.target_date) - (!b.target_date) || String(a.target_date).localeCompare(String(b.target_date)))
    .map(project);
}

export function saveGoal(payload, id) {
  if (id) sheets.update('Goals', id, payload);
  else sheets.insert('Goals', { ...payload, created_at: new Date().toISOString() });
}

export const deleteGoal = (id) => sheets.remove('Goals', id);
