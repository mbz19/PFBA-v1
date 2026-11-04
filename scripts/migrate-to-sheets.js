#!/usr/bin/env node
// Dev-only: copy Budget, Transactions, Recurring and Goals data from the old
// local SQLite database (data/pfba.db) into the app's Google Spreadsheet.
// Lives outside client/ so it is never part of the app bundle.
//
// Usage:
//   node scripts/migrate-to-sheets.js                 # dry run: prints row counts, writes nothing
//   SHEET_ID=… ACCESS_TOKEN=… node scripts/migrate-to-sheets.js --write
//   … --write --force                                 # overwrite tabs that already have data
//
// ACCESS_TOKEN needs the https://www.googleapis.com/auth/spreadsheets scope
// for the account that owns the sheet, e.g. from the OAuth 2.0 Playground or:
//   gcloud auth login --enable-gdrive-access && gcloud auth print-access-token
// Options: --db <path> (default data/pfba.db)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { TABS } from '../client/src/lib/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const WRITE = flag('--write');
const FORCE = flag('--force');
const DB_PATH = path.resolve(opt('--db', path.join(__dirname, '..', 'data', 'pfba.db')));
const SHEET_ID = process.env.SHEET_ID;
const TOKEN = process.env.ACCESS_TOKEN;

const pad = (n) => String(n).padStart(2, '0');
const str = (v) => (v === null || v === undefined ? '' : String(v));

// ---------------------------------------------------------------------------
// Read SQLite
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const all = (sql, ...p) => db.prepare(sql).all(...p);
const tableExists = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

const accountName = Object.fromEntries(
  (tableExists('accounts') ? all('SELECT id, name FROM accounts') : []).map((a) => [a.id, a.name])
);

const source = {};
const count = (t) => (source[t] = tableExists(t) ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : 0);
['categories', 'budget_periods', 'budget_allocations', 'period_income', 'transactions',
  'transaction_splits', 'tags', 'transaction_tags', 'recurring_items', 'goals', 'settings'].forEach(count);

// Budget tab: categories + allocations + expected income
const budget = [];
for (const c of all('SELECT * FROM categories ORDER BY id')) {
  budget.push({
    kind: 'category', id: str(c.id), name: c.name, parent_id: str(c.parent_id), bucket: c.bucket,
    urgency: str(c.urgency), cap_type: c.cap_type, icon: c.icon, sort_order: c.sort_order, archived: !!c.archived,
  });
}
for (const a of all(`SELECT a.id, a.category_id, a.amount, p.year, p.month
                     FROM budget_allocations a JOIN budget_periods p ON p.id = a.period_id ORDER BY a.id`)) {
  budget.push({ kind: 'allocation', id: `a${a.id}`, month: `${a.year}-${pad(a.month)}`, category_id: str(a.category_id), amount: a.amount });
}
for (const i of all(`SELECT i.period_id, i.amount, p.year, p.month
                     FROM period_income i JOIN budget_periods p ON p.id = i.period_id`)) {
  budget.push({ kind: 'income', id: `i${i.period_id}`, month: `${i.year}-${pad(i.month)}`, amount: i.amount });
}

// Transactions tab: one row per split
const tagsByTxn = {};
for (const r of all('SELECT tt.transaction_id, t.name FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id')) {
  (tagsByTxn[r.transaction_id] ||= []).push(r.name);
}
const splitsByTxn = {};
for (const s of all('SELECT * FROM transaction_splits ORDER BY id')) (splitsByTxn[s.transaction_id] ||= []).push(s);
const transactions = [];
for (const t of all('SELECT * FROM transactions ORDER BY date, id')) {
  const base = {
    txn_id: `t${t.id}`, date: t.date, merchant: t.merchant, description: t.description,
    account: accountName[t.account_id] || '', is_income: !!t.is_income,
    tags: (tagsByTxn[t.id] || []).join(', '), notes: t.notes, created_at: t.created_at,
  };
  const splits = splitsByTxn[t.id] || [{ id: `x${t.id}`, category_id: null, amount: t.amount }];
  for (const s of splits) transactions.push({ ...base, id: `s${s.id}`, category_id: str(s.category_id), amount: s.amount });
}

const recurring = all('SELECT * FROM recurring_items ORDER BY id').map((r) => ({
  id: str(r.id), name: r.name, amount: r.amount, frequency: r.frequency, next_due: str(r.next_due),
  category_id: str(r.category_id), account: accountName[r.account_id] || '',
  auto_detected: !!r.auto_detected, active: !!r.active,
}));

const goals = all('SELECT * FROM goals ORDER BY id').map((g) => ({
  id: str(g.id), name: g.name, target_amount: g.target_amount, current_amount: g.current_amount,
  monthly_contribution: g.monthly_contribution || 0, target_date: str(g.target_date), priority: g.priority,
  account: accountName[g.account_id] || '', why: g.why, created_at: g.created_at,
}));

// Only the budget split carries over; other old settings belonged to removed pages.
const splitSettings = all("SELECT key, value FROM settings WHERE key IN ('split_needs','split_investing','split_wants')");

const out = { Budget: budget, Transactions: transactions, Recurring: recurring, Goals: goals };

console.log(`\nSource: ${DB_PATH}`);
console.log('SQLite row counts:');
for (const [t, n] of Object.entries(source)) console.log(`  ${t.padEnd(20)} ${n}`);
console.log('\nRows to write:');
for (const [tab, rows] of Object.entries(out)) console.log(`  ${tab.padEnd(20)} ${rows.length}`);
console.log(`  ${'Settings (split %)'.padEnd(20)} ${splitSettings.length}`);

if (!WRITE) {
  console.log('\nDry run — nothing written. Re-run with --write (and SHEET_ID + ACCESS_TOKEN) to migrate.\n');
  process.exit(0);
}
if (!SHEET_ID || !TOKEN) {
  console.error('\nSHEET_ID and ACCESS_TOKEN environment variables are required with --write.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write to Google Sheets
// ---------------------------------------------------------------------------
const API = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
async function api(pathPart, { method = 'GET', body } = {}) {
  const res = await fetch(API + pathPart, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathPart}: ${json.error?.message || res.status}`);
  return json;
}
const quote = (t) => `'${t.replace(/'/g, "''")}'`;
const cells = (header, row) => header.map((h) => (row[h] === undefined || row[h] === null ? '' : row[h]));

const meta = await api('?fields=sheets.properties.title');
const existing = new Set(meta.sheets.map((s) => s.properties.title));
const missing = [...Object.keys(out), 'Settings'].filter((t) => !existing.has(t));
if (missing.length) {
  await api(':batchUpdate', { method: 'POST', body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) } });
  console.log(`\nCreated tabs: ${missing.join(', ')}`);
}

const current = await api(`/values:batchGet?${[...Object.keys(out), 'Settings'].map((t) => `ranges=${encodeURIComponent(quote(t))}`).join('&')}`);
const currentRows = Object.fromEntries(current.valueRanges.map((vr, i) => [[...Object.keys(out), 'Settings'][i], vr.values || []]));

const nonEmpty = Object.keys(out).filter((t) => currentRows[t].length > 1);
if (nonEmpty.length && !FORCE) {
  console.error(`\nThese tabs already contain data: ${nonEmpty.join(', ')}. Re-run with --force to overwrite them.\n`);
  process.exit(1);
}

const data = Object.entries(out).map(([tab, rows]) => {
  const header = Object.keys(TABS[tab]);
  return { range: `${quote(tab)}!A1`, values: [header, ...rows.map((r) => cells(header, r))] };
});

// Settings: upsert the split keys, keep everything else (accounts list, etc.).
const sHeader = ['key', 'value'];
const settingsMap = new Map((currentRows.Settings.slice(1) || []).map((r) => [String(r[0]), String(r[1] ?? '')]));
for (const s of splitSettings) settingsMap.set(s.key, s.value);
data.push({ range: `${quote('Settings')}!A1`, values: [sHeader, ...[...settingsMap].map(([k, v]) => [k, v])] });

await api('/values:batchClear', { method: 'POST', body: { ranges: Object.keys(out).map(quote) } });
await api('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });

console.log('\nWrote:');
for (const [tab, rows] of Object.entries(out)) console.log(`  ${tab.padEnd(20)} ${rows.length} rows`);
console.log(`  ${'Settings'.padEnd(20)} ${settingsMap.size} keys`);
console.log(`\nDone: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
