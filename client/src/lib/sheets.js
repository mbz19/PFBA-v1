// The app's only gateway to Google Sheets. Pages call these functions (via
// finance.js / workouts.js helpers) and never hit the API directly.
//
// Reads: every tab is loaded once with a single values:batchGet and cached in
// memory. Writes: mutations update the cache immediately (so the UI is
// instant), mark the tab dirty, and a debounced flush rewrites all dirty tabs
// in ONE spreadsheets:batchUpdate request. Rewriting the whole tab keeps row
// order simple and is cheap at personal-finance scale.

import { authedFetch } from './auth.js';
import {
  TABS, WORKOUT_PREFIX, SPREADSHEET_TITLE, DEFAULT_SETTINGS, columnsFor, fromCells,
} from './schema.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const FLUSH_DELAY = 800;

let spreadsheetId = null;
let owner = null; // primary account email — the only account with the Sheets scope

// tab -> { sheetId, header, rows, sheetRows, sheetCols, gridRows, gridCols }
// sheetRows/sheetCols = extent currently written in the sheet, so a rewrite
// can blank out rows that were deleted.
const tables = new Map();
const dirty = new Set();
const listeners = new Set();
let flushTimer = null;
let flushing = null;
let status = { saving: false, error: null };
let version = 0;

const notify = () => { version++; listeners.forEach((fn) => fn()); };
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getVersion = () => version;
export const getStatus = () => status;
export const getSpreadsheetId = () => spreadsheetId;
export const spreadsheetUrl = () => spreadsheetId && `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

const call = (path, opts) => authedFetch(owner, `${API}${path}`, opts);
const quote = (title) => `'${title.replace(/'/g, "''")}'`;

export function newId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 12);
}

// Accepts a raw ID or a full docs.google.com URL.
export function parseSpreadsheetId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}

// ---------------------------------------------------------------------------
// Open / create
// ---------------------------------------------------------------------------
export async function createSpreadsheet(ownerEmail) {
  owner = ownerEmail;
  const res = await call('', {
    method: 'POST',
    body: {
      properties: { title: SPREADSHEET_TITLE },
      sheets: Object.keys(TABS).map((title) => ({ properties: { title } })),
    },
  });
  return res.spreadsheetId;
}

// Point the data layer at a spreadsheet, add any missing tabs/headers, and
// load everything into the cache.
export async function open(id, ownerEmail) {
  spreadsheetId = id;
  owner = ownerEmail;
  tables.clear();
  dirty.clear();
  await load();
  // Seed default settings on a brand-new sheet.
  const have = new Set(rows('Settings').map((r) => r.key));
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!have.has(key)) insert('Settings', { key, value });
  }
  if (dirty.size) await flush();
}

async function getSheetProps() {
  const meta = await call(`/${spreadsheetId}`, {
    query: { fields: 'properties.title,sheets.properties(sheetId,title,gridProperties)' },
  });
  return meta.sheets.map((s) => s.properties);
}

async function load() {
  let props = await getSheetProps();
  const missing = Object.keys(TABS).filter((t) => !props.some((p) => p.title === t));
  if (missing.length) {
    await call(`/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
    props = await getSheetProps();
  }
  const wanted = props.filter((p) => TABS[p.title] || p.title.startsWith(WORKOUT_PREFIX));
  // One read for every tab. batchGet takes repeated `ranges=` params.
  const params = new URLSearchParams({
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  for (const p of wanted) params.append('ranges', quote(p.title));
  const data = await authedFetch(owner, `${API}/${spreadsheetId}/values:batchGet?${params}`);
  data.valueRanges.forEach((vr, i) => hydrate(wanted[i], vr.values || []));
}

function hydrate(prop, values) {
  const columns = columnsFor(prop.title);
  const sheetHeader = (values[0] || []).map((h) => String(h).trim());
  // Keep any extra columns the user added by hand; append missing schema columns.
  const header = [...sheetHeader.filter(Boolean)];
  for (const c of Object.keys(columns)) if (!header.includes(c)) header.push(c);
  const rows = values.slice(1)
    .filter((r) => r.some((c) => c !== '' && c !== null && c !== undefined))
    .map((r) => {
      const cells = header.map((h) => r[sheetHeader.indexOf(h)]);
      return fromCells(header, cells, columns);
    });
  tables.set(prop.title, {
    sheetId: prop.sheetId,
    header,
    rows,
    sheetRows: values.length,
    sheetCols: Math.max(sheetHeader.length, 1),
    gridRows: prop.gridProperties?.rowCount ?? 1000,
    gridCols: prop.gridProperties?.columnCount ?? 26,
  });
  if (sheetHeader.join('\u0001') !== header.join('\u0001')) dirty.add(prop.title);
}

// Drop the cache and re-read the sheet (e.g. after editing it in Google Sheets).
export async function reload() {
  await flush();
  tables.clear();
  await load();
  notify();
}

// ---------------------------------------------------------------------------
// Reads (from cache)
// ---------------------------------------------------------------------------
const EMPTY = Object.freeze([]);
export function rows(tab) {
  return tables.get(tab)?.rows ?? EMPTY;
}

export function settings() {
  return Object.fromEntries(rows('Settings').map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------------------
// Writes (cache first, flushed in a batch)
// ---------------------------------------------------------------------------
function table(tab) {
  const t = tables.get(tab);
  if (!t) throw new Error(`Tab not loaded: ${tab}`);
  return t;
}

function touch(tab) {
  dirty.add(tab);
  notify();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flush().catch(() => {}); }, FLUSH_DELAY);
}

export function insert(tab, obj) {
  const t = table(tab);
  const row = { ...obj };
  if ('id' in columnsFor(tab) && !row.id) row.id = newId();
  t.rows = [...t.rows, row];
  touch(tab);
  return row;
}

export function insertMany(tab, objs) {
  const t = table(tab);
  const added = objs.map((o) => ({ ...o, id: o.id || newId() }));
  t.rows = [...t.rows, ...added];
  touch(tab);
  return added;
}

export function update(tab, id, patch) {
  const t = table(tab);
  t.rows = t.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
  touch(tab);
}

export function removeWhere(tab, pred) {
  const t = table(tab);
  t.rows = t.rows.filter((r) => !pred(r));
  touch(tab);
}

export const remove = (tab, id) => removeWhere(tab, (r) => r.id === id);

// Replace all rows (used for reordering).
export function setRows(tab, next) {
  table(tab).rows = [...next];
  touch(tab);
}

export function setSetting(key, value) {
  const existing = rows('Settings').find((r) => r.key === key);
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  if (existing) {
    const t = table('Settings');
    t.rows = t.rows.map((r) => (r.key === key ? { ...r, value: v } : r));
    touch('Settings');
  } else {
    insert('Settings', { key, value: v });
  }
}

function cell(v) {
  if (v === undefined || v === null || v === '') return {};
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v } };
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  // stringValue is stored literally — no formula or date parsing.
  return { userEnteredValue: { stringValue: String(v) } };
}

function tabRequests(t) {
  const reqs = [];
  const needRows = t.rows.length + 1;
  const needCols = t.header.length;
  let { gridRows, gridCols } = t;
  if (needRows > gridRows) {
    reqs.push({ appendDimension: { sheetId: t.sheetId, dimension: 'ROWS', length: needRows - gridRows + 100 } });
    gridRows = needRows + 100;
  }
  if (needCols > gridCols) {
    gridCols = needCols;
    reqs.push({ appendDimension: { sheetId: t.sheetId, dimension: 'COLUMNS', length: needCols - t.gridCols } });
  }
  const endRow = Math.max(needRows, t.sheetRows);
  const endCol = Math.max(needCols, t.sheetCols);
  reqs.push({
    updateCells: {
      // Rows/cells inside this range that we don't send are cleared, which is
      // how deleted rows disappear from the sheet.
      range: { sheetId: t.sheetId, startRowIndex: 0, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: endCol },
      fields: 'userEnteredValue',
      rows: [
        { values: t.header.map((h) => cell(h)) },
        ...t.rows.map((r) => ({ values: t.header.map((h) => cell(r[h])) })),
      ],
    },
  });
  return { reqs, after: { sheetRows: needRows, sheetCols: needCols, gridRows, gridCols } };
}

export async function flush() {
  clearTimeout(flushTimer);
  if (flushing) { await flushing.catch(() => {}); }
  if (!dirty.size || !spreadsheetId) return;
  const tabs = [...dirty];
  dirty.clear();
  const plans = tabs.filter((tab) => tables.has(tab)).map((tab) => ({ tab, ...tabRequests(tables.get(tab)) }));
  status = { saving: true, error: null };
  notify();
  flushing = call(`/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: { requests: plans.flatMap((p) => p.reqs) },
  });
  try {
    await flushing;
    for (const p of plans) Object.assign(tables.get(p.tab) || {}, p.after);
    status = { saving: false, error: null };
  } catch (err) {
    tabs.forEach((t) => dirty.add(t)); // keep for retry
    status = { saving: false, error: err.message || 'Save failed' };
    throw err;
  } finally {
    flushing = null;
    notify();
  }
  if (dirty.size) touch([...dirty][0]);
}

export const hasUnsaved = () => dirty.size > 0 || Boolean(flushing);

if (typeof window !== 'undefined') {
  // Save promptly when the tab is backgrounded (phones rarely fire unload).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush().catch(() => {});
  });
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsaved()) { flush().catch(() => {}); e.preventDefault(); e.returnValue = ''; }
  });
}

// ---------------------------------------------------------------------------
// Workout tabs (one sheet tab per workout)
// ---------------------------------------------------------------------------
export function workoutTabs() {
  return [...tables.keys()].filter((t) => t.startsWith(WORKOUT_PREFIX)).sort();
}

async function structural(requests) {
  await flush();
  return call(`/${spreadsheetId}:batchUpdate`, { method: 'POST', body: { requests } });
}

export async function createWorkoutTab(name) {
  const title = WORKOUT_PREFIX + name.trim();
  if (tables.has(title)) throw new Error('A workout with that name already exists.');
  const res = await structural([{ addSheet: { properties: { title } } }]);
  const prop = res.replies[0].addSheet.properties;
  hydrate(prop, []);
  dirty.add(title); // write the header row
  touch(title);
  return title;
}

export async function renameWorkoutTab(oldTitle, name) {
  const title = WORKOUT_PREFIX + name.trim();
  if (title === oldTitle) return oldTitle;
  if (tables.has(title)) throw new Error('A workout with that name already exists.');
  const t = table(oldTitle);
  await structural([{ updateSheetProperties: { properties: { sheetId: t.sheetId, title }, fields: 'title' } }]);
  tables.delete(oldTitle);
  tables.set(title, t);
  notify();
  return title;
}

export async function deleteWorkoutTab(title) {
  const t = table(title);
  await structural([{ deleteSheet: { sheetId: t.sheetId } }]);
  tables.delete(title);
  dirty.delete(title);
  notify();
}
