// Finance data (Transactions, Budget, Recurring, Goals, FinanceSettings) in a
// real SQLite database (sql.js) that lives in this browser, saved to
// IndexedDB, and synced between devices through the encrypted vault file in
// Google Drive (vault.js). Nothing here is ever sent to Google unencrypted.
//
// Same read/write surface as sheets.js (rows/insert/update/removeWhere), which
// routes finance tabs here, so pages don't know where the data lives. Reads
// come from an in-memory cache; every write goes to SQLite immediately, is
// saved locally shortly after, and synced a few seconds later.
//
// Sync merges row by row: every row carries _updated_at (ms) and _deleted, so
// edits made on two devices before they sync are combined, the newer edit of
// the same row wins, and deletions propagate.

import initSqlJs from 'sql.js';
import { FINANCE_TABLES, DEFAULT_FINANCE_SETTINGS, coerce, naturalId } from './schema.js';
import * as vault from './vault.js';

const PERSIST_DELAY = 300;
const SYNC_DELAY = 3000;
const SYNC_INTERVAL = 30 * 1000;
const TABLES = Object.keys(FINANCE_TABLES);
const SQL_TYPE = { str: 'TEXT', date: 'TEXT', num: 'REAL', bool: 'INTEGER' };

let SQL = null;
let db = null;
let key = null; // non-extractable AES key (vault.deriveKey)
let salt = null;
let owner = null; // primary account email; the vault lives in its Drive
let remote = null; // { id, version } of the vault file as last seen
let localChanges = false; // edits not yet uploaded
const cache = new Map(); // table -> rows[]

// closed | new (no vault yet) | locked (vault exists, passphrase needed) | ready
let state = 'closed';
let status = { syncing: false, error: null, lastSync: null };
let version = 0;
const listeners = new Set();

const notify = () => { version++; listeners.forEach((fn) => fn()); };
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getVersion = () => version;
export const getState = () => state;
export const getStatus = () => status;
export const hasUnsynced = () => localChanges || status.syncing;
const setState = (s) => { state = s; notify(); };
const setStatus = (patch) => { status = { ...status, ...patch }; notify(); };

export function newId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 12);
}

// ---------------------------------------------------------------------------
// IndexedDB: the SQLite file, the derived key and sync bookkeeping
// ---------------------------------------------------------------------------
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pfba-finance', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => { d.close(); resolve(req?.result); };
    tx.onerror = () => { d.close(); reject(tx.error); };
  });
}
const kvGet = (k) => kv('readonly', (s) => s.get(k));
const kvSet = (entries) => kv('readwrite', (s) => { for (const [k, v] of Object.entries(entries)) s.put(v, k); });
const kvClear = () => kv('readwrite', (s) => s.clear());

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------
const q = (name) => `"${name}"`;

async function initSql() {
  // __SQL_WASM__ is defined by the sql-wasm plugin in vite.config.js.
  if (!SQL) SQL = await initSqlJs({ locateFile: () => __SQL_WASM__ }); // eslint-disable-line no-undef
}

// One table per finance tab with the schema's columns, plus sync metadata.
// Columns added to the schema later are added in place.
function ensureSchema(d) {
  for (const [tab, cols] of Object.entries(FINANCE_TABLES)) {
    const defs = Object.entries(cols).map(([c, t]) => (c === 'id' ? '"id" TEXT PRIMARY KEY' : `${q(c)} ${SQL_TYPE[t]}`));
    d.run(`CREATE TABLE IF NOT EXISTS ${q(tab)} (${defs.join(', ')}, "_updated_at" INTEGER NOT NULL DEFAULT 0, "_deleted" INTEGER NOT NULL DEFAULT 0)`);
    const have = new Set((d.exec(`PRAGMA table_info(${q(tab)})`)[0]?.values || []).map((v) => v[1]));
    for (const [c, t] of Object.entries(cols)) if (!have.has(c)) d.run(`ALTER TABLE ${q(tab)} ADD COLUMN ${q(c)} ${SQL_TYPE[t]}`);
  }
}

// Live rows as app objects, or (withMeta) every row as stored, tombstones included.
function readAll(d, tab, { withMeta = false } = {}) {
  const res = d.exec(`SELECT * FROM ${q(tab)}${withMeta ? '' : ' WHERE "_deleted" = 0'} ORDER BY rowid`);
  if (!res.length) return [];
  const { columns, values } = res[0];
  const cols = FINANCE_TABLES[tab];
  return values.map((v) => {
    const o = Object.fromEntries(columns.map((c, i) => [c, v[i]]));
    if (withMeta) return o;
    return Object.fromEntries(Object.entries(cols).map(([c, t]) => [c, coerce(t, o[c])]));
  });
}

function upsert(tab, row, updatedAt, deleted = 0) {
  const cols = Object.keys(FINANCE_TABLES[tab]);
  const all = [...cols, '_updated_at', '_deleted'];
  const vals = cols.map((c) => {
    const v = row[c];
    return typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null;
  });
  db.run(
    `INSERT INTO ${q(tab)} (${all.map(q).join(', ')}) VALUES (${all.map(() => '?').join(', ')})
     ON CONFLICT("id") DO UPDATE SET ${all.filter((c) => c !== 'id').map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`,
    [...vals, updatedAt, deleted],
  );
}

function transaction(fn) {
  db.run('BEGIN');
  try { fn(); db.run('COMMIT'); } catch (err) { db.run('ROLLBACK'); throw err; }
}

// Collapse rows that mean the same thing (see schema.naturalId) into one row
// under the derived id, keeping the most recently edited value. Cleans up
// duplicates created before ids were derived, or by a device still running
// older code. Returns true if anything changed (so it needs uploading).
function dedupe() {
  let changed = false;
  const now = Date.now();
  transaction(() => {
    for (const tab of TABLES) {
      const groups = new Map();
      for (const r of readAll(db, tab, { withMeta: true })) {
        const nid = !r._deleted && naturalId(tab, r);
        if (nid) groups.set(nid, [...(groups.get(nid) || []), r]);
      }
      for (const [nid, group] of groups) {
        if (group.length === 1 && group[0].id === nid) continue;
        const winner = group.reduce((a, b) => (b._updated_at > a._updated_at ? b : a));
        upsert(tab, { ...winner, id: nid }, winner._updated_at);
        for (const r of group) if (r.id !== nid) upsert(tab, { id: r.id }, now, 1);
        changed = true;
      }
    }
  });
  return changed;
}

function load(bytes) {
  db?.close();
  db = new SQL.Database(bytes);
  ensureSchema(db);
  if (dedupe()) localChanges = true;
  for (const tab of TABLES) cache.set(tab, readAll(db, tab));
}

// ---------------------------------------------------------------------------
// Open / unlock / create
// ---------------------------------------------------------------------------
// Returns 'ready' (this device already has the key), 'locked' (a vault
// exists; ask for the passphrase) or 'new' (no vault yet; create one).
export async function open(email) {
  await initSql();
  owner = email;
  const [storedOwner, storedKey, storedSalt, bytes, pending] = await Promise.all(
    ['owner', 'key', 'salt', 'db', 'localChanges'].map(kvGet),
  );
  if (storedOwner === email && storedKey && storedSalt && bytes) {
    key = storedKey;
    salt = storedSalt;
    localChanges = Boolean(pending);
    load(bytes); // may set localChanges (dedupe)
    setState('ready');
    sync().catch(() => {});
    return state;
  }
  remote = await vault.find(email);
  setState(remote ? 'locked' : 'new');
  return state;
}

// Throws vault.WrongPassphrase if it doesn't decrypt.
export async function unlock(passphrase) {
  remote = remote || await vault.find(owner);
  if (!remote) throw new Error('No finance vault found in Google Drive.');
  const file = await vault.download(owner, remote.id);
  const s = vault.saltOf(file);
  const k = await vault.deriveKey(passphrase, s);
  const plain = await vault.decrypt(k, file);
  key = k;
  salt = s;
  localChanges = false;
  load(plain);
  await kvSet({ owner, key, salt, db: db.export(), localChanges });
  if (localChanges) scheduleSync(0);
  status = { syncing: false, error: null, lastSync: Date.now() };
  setState('ready');
}

// New vault, optionally seeded with rows ({ table: rows[] }, e.g. from the
// old spreadsheet tabs), then uploaded.
export async function create(passphrase, seed) {
  // Another device may have created the vault since this one checked; never
  // start a second vault next to it.
  remote = await vault.find(owner);
  if (remote) {
    setState('locked');
    throw new Error('Your finances were already set up on another device. Enter that passphrase to unlock them here.');
  }
  salt = vault.newSalt();
  key = await vault.deriveKey(passphrase, salt);
  remote = null;
  load();
  setState('ready');
  if (seed) importRows(seed);
  localChanges = true;
  await kvSet({ owner, key, salt, db: db.export(), localChanges: true });
  await sync();
}

// Drop the in-memory copy (sign-out). The device keeps its local copy and key.
export async function close() {
  if (state === 'ready') await persist().catch(() => {});
  clearTimeout(persistTimer);
  clearTimeout(syncTimer);
  db?.close();
  db = null;
  key = null;
  salt = null;
  cache.clear();
  setState('closed');
}

// Wipe this device's copy and key. The vault in Drive is untouched; the next
// open asks for the passphrase again.
export async function forgetDevice() {
  await close();
  localChanges = false;
  await kvClear();
  remote = owner ? await vault.find(owner) : null;
  setState(remote ? 'locked' : 'new');
}

// ---------------------------------------------------------------------------
// Reads & writes (same shape as sheets.js)
// ---------------------------------------------------------------------------
const EMPTY = Object.freeze([]);
export const rows = (tab) => cache.get(tab) ?? EMPTY;

// Write the difference between the cached rows and `next`: changed or new
// rows are upserted, missing rows become tombstones (id only, so deleted data
// doesn't linger).
function commit(tab, next) {
  if (!db) throw new Error('Finances are locked.');
  const prevById = new Map(rows(tab).map((r) => [r.id, r]));
  const nextIds = new Set(next.map((r) => r.id));
  const now = Date.now();
  transaction(() => {
    for (const r of next) if (prevById.get(r.id) !== r) upsert(tab, r, now);
    for (const [id] of prevById) if (!nextIds.has(id)) upsert(tab, { id }, now, 1);
  });
  cache.set(tab, next);
  localChanges = true;
  notify();
  schedulePersist();
  scheduleSync();
}

const idFor = (tab, obj) => obj.id || naturalId(tab, obj) || newId();

// Inserting a row whose id already exists replaces it.
export function insert(tab, obj) {
  const row = { ...obj, id: idFor(tab, obj) };
  commit(tab, [...rows(tab).filter((r) => r.id !== row.id), row]);
  return row;
}

export function insertMany(tab, objs) {
  const added = objs.map((o) => ({ ...o, id: idFor(tab, o) }));
  const ids = new Set(added.map((r) => r.id));
  commit(tab, [...rows(tab).filter((r) => !ids.has(r.id)), ...added]);
  return added;
}

export function update(tab, id, patch) {
  commit(tab, rows(tab).map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

export function removeWhere(tab, pred) {
  commit(tab, rows(tab).filter((r) => !pred(r)));
}

export function settings() {
  return { ...DEFAULT_FINANCE_SETTINGS, ...Object.fromEntries(rows('FinanceSettings').map((r) => [r.id, r.value])) };
}

export function setSetting(k, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  if (rows('FinanceSettings').some((r) => r.id === k)) update('FinanceSettings', k, { value: v });
  else insert('FinanceSettings', { id: k, value: v });
}

// Add or replace rows by id: { table: rows[] }.
export function importRows(data) {
  for (const tab of TABLES) {
    const incoming = (data[tab] || []).map((r) => ({ ...r, id: naturalId(tab, r) || r.id || newId() }));
    if (!incoming.length) continue;
    const ids = new Set(incoming.map((r) => r.id));
    commit(tab, [...rows(tab).filter((r) => !ids.has(r.id)), ...incoming]);
  }
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------
export const exportSqlite = () => db.export();
export const exportEncrypted = () => vault.encrypt(key, salt, db.export());

// ---------------------------------------------------------------------------
// Local save + sync
// ---------------------------------------------------------------------------
let persistTimer = null;
let syncTimer = null;

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persist().catch(() => {}); }, PERSIST_DELAY);
}

async function persist() {
  clearTimeout(persistTimer);
  if (db) await kvSet({ db: db.export(), localChanges });
}

function scheduleSync(delay = SYNC_DELAY) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { sync().catch(() => {}); }, delay);
}

// Merge another copy of the database into ours. Returns true when ours has
// changes the other copy lacks (so it needs uploading).
function mergeFrom(bytes) {
  const other = new SQL.Database(bytes);
  let oursNewer = false;
  let pulled = false;
  try {
    ensureSchema(other);
    transaction(() => {
      for (const tab of TABLES) {
        const theirs = new Map(readAll(other, tab, { withMeta: true }).map((r) => [r.id, r]));
        const mine = new Map(readAll(db, tab, { withMeta: true }).map((r) => [r.id, r]));
        for (const [id, t] of theirs) {
          const m = mine.get(id);
          if (!m || t._updated_at > m._updated_at) { upsert(tab, t, t._updated_at, t._deleted); pulled = true; } else if (m._updated_at > t._updated_at) oursNewer = true;
        }
        for (const id of mine.keys()) if (!theirs.has(id)) oursNewer = true;
      }
    });
  } finally {
    other.close();
  }
  if (pulled && dedupe()) oursNewer = true;
  if (pulled) {
    for (const tab of TABLES) cache.set(tab, readAll(db, tab));
    notify();
  }
  return oursNewer;
}

let syncing = null;
let syncAgain = false;

// Pull the vault if another device changed it, merge, and upload if we have
// anything it lacks. Calls made while a sync runs fold into one more pass.
export function sync() {
  if (state !== 'ready') return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    clearTimeout(syncTimer);
    setStatus({ syncing: true, error: null });
    let cleared = false;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const found = await vault.find(owner);
        let mustUpload = localChanges || !found;
        if (found && found.version !== remote?.version) {
          const plain = await vault.decrypt(key, await vault.download(owner, found.id));
          if (mergeFrom(plain)) mustUpload = true;
        }
        remote = found;
        if (!mustUpload) break;
        // Another device may have uploaded while we merged; if so, go again.
        if (found && (await vault.find(owner))?.version !== found.version) continue;
        localChanges = false;
        cleared = true;
        remote = await vault.upload(owner, found?.id || null, await vault.encrypt(key, salt, db.export()));
        cleared = false;
        break;
      }
      await persist();
      setStatus({ syncing: false, error: null, lastSync: Date.now() });
    } catch (err) {
      if (cleared) localChanges = true;
      await persist().catch(() => {});
      setStatus({ syncing: false, error: err.message || 'Sync failed' });
      throw err;
    } finally {
      syncing = null;
      if (syncAgain) { syncAgain = false; scheduleSync(0); }
    }
  })();
  return syncing;
}

if (typeof window !== 'undefined') {
  // Pick up other devices' edits when coming back to the app (tab shown or
  // window focused), save and push ours when leaving, and check in every 30
  // seconds while open.
  window.addEventListener('focus', () => { if (state === 'ready') sync().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (state !== 'ready') return;
    if (document.visibilityState === 'visible') sync().catch(() => {});
    else { persist().catch(() => {}); if (localChanges) sync().catch(() => {}); }
  });
  window.addEventListener('online', () => { if (state === 'ready') sync().catch(() => {}); });
  setInterval(() => {
    if (state === 'ready' && document.visibilityState === 'visible') sync().catch(() => {});
  }, SYNC_INTERVAL);
}
