// Shared app state: Google session + connected accounts, the spreadsheet
// connection, the selected budget month, and a subscription to the sheets
// cache so any write re-renders the views that read it.
import { createContext, useContext, useState, useCallback, useSyncExternalStore, useRef, useEffect } from 'react';
import * as auth from './lib/auth.js';
import * as sheets from './lib/sheets.js';
import { forgetAccount } from './lib/agenda.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Re-render whenever the sheets cache or save status changes.
export function useSheetData() {
  return useSyncExternalStore(sheets.subscribe, sheets.getVersion);
}

export const ACCOUNT_COLORS = ['#4f46e5', '#0f9d58', '#db4437', '#f4b400', '#0097a7', '#ab47bc', '#ff7043', '#5c6bc0'];

// Per-viewer conveniences only (emails, display names, colors and the sheet
// ID) — never tokens.
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const PRIMARY_KEY = 'pfba.primaryEmail';
const SHEET_KEY = 'pfba.sheetId';
const KNOWN_KEY = 'pfba.knownAccounts';

// Accounts remembered on this device, shown on the sign-in screen.
export function knownAccounts() {
  return parseAccounts(LS.get(KNOWN_KEY));
}

function parseAccounts(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((a) => a && a.email) : [];
  } catch { return []; }
}

export function AppProvider({ children }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // signed-out | signing-in | needs-sheet | loading | connect-accounts | ready
  const [phase, setPhase] = useState('signed-out');
  const [error, setError] = useState(null);
  const [primary, setPrimary] = useState(LS.get(PRIMARY_KEY));
  const [status, setStatus] = useState({}); // email -> { state: 'idle'|'connecting'|'ok'|'error', error }
  useSheetData(); // re-read accounts from Settings when the cache changes
  const busy = useRef(false);

  const signedIn = phase === 'ready' || phase === 'connect-accounts';
  const accounts = signedIn ? parseAccounts(sheets.settings().accounts) : [];
  const accountsKey = JSON.stringify(accounts.map((a) => [a.email, a.name, a.color, !!a.primary]));

  const setAcctStatus = (email, s) => setStatus((m) => ({ ...m, [email]: s }));

  // Load Google's sign-in script up front so a tap opens the popup
  // synchronously (Safari blocks popups opened after an await).
  useEffect(() => { auth.preload().catch(() => {}); }, []);

  // Token changes (including background refreshes on a tap) drive status.
  useEffect(() => auth.onAuthChange((email, state, err) => {
    setAcctStatus(email, state === 'error' ? { state, error: err } : { state });
  }), []);

  // Tell auth which accounts to keep fresh, and remember them on this device
  // so the sign-in screen can show who will be reconnected.
  useEffect(() => {
    if (!signedIn) return;
    auth.setWantedAccounts(accounts);
    LS.set(KNOWN_KEY, JSON.stringify(accounts.map(({ email, name, color, primary: p }) => ({ email, name, color, primary: !!p }))));
  }, [signedIn, accountsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveAccounts(list) {
    sheets.setSetting('accounts', JSON.stringify(list));
  }

  // After the sheet is open: make sure the primary is listed. Secondary
  // accounts each need their own tap (one popup per tap), so if any aren't
  // connected yet, show the "connect your other accounts" step.
  const finishOpen = useCallback((primaryEmail, profileName) => {
    let list = parseAccounts(sheets.settings().accounts);
    if (!list.some((a) => a.email === primaryEmail)) {
      list = [{ email: primaryEmail, name: profileName || primaryEmail, color: ACCOUNT_COLORS[0], editable: true }, ...list];
    }
    list = list.map((a) => ({ ...a, primary: a.email === primaryEmail }));
    saveAccounts(list);
    setStatus((m) => {
      const next = { ...m, [primaryEmail]: { state: 'ok' } };
      for (const a of list) if (!a.primary && !auth.hasToken(a.email)) next[a.email] = { state: 'idle' };
      return next;
    });
    setPhase(list.some((a) => !a.primary && !auth.hasToken(a.email)) ? 'connect-accounts' : 'ready');
  }, []);

  const finishConnecting = useCallback(() => setPhase('ready'), []);

  const openSheet = useCallback(async (id, primaryEmail, profileName) => {
    setPhase('loading');
    try {
      await sheets.open(id, primaryEmail);
      LS.set(SHEET_KEY, id);
      finishOpen(primaryEmail, profileName);
    } catch (err) {
      setError(err.status === 404 || err.status === 403
        ? `Can't open that spreadsheet as ${primaryEmail}. Check the ID and that this account owns it.`
        : err.message);
      setPhase('needs-sheet');
    }
  }, [finishOpen]);

  // Must be called from a click (opens the Google popup).
  const signIn = useCallback(async ({ switchAccount = false } = {}) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setPhase('signing-in');
    try {
      let email = !switchAccount && primary;
      let name;
      if (email) {
        const p = await auth.connect(email, { isPrimary: true, interactive: true });
        name = p.name;
      } else {
        const p = await auth.addAccount({ isPrimary: true });
        email = p.email;
        name = p.name;
      }
      setPrimary(email);
      LS.set(PRIMARY_KEY, email);
      const sheetId = import.meta.env.VITE_SHEET_ID || LS.get(SHEET_KEY);
      if (sheetId) await openSheet(sheetId, email, name);
      else setPhase('needs-sheet');
    } catch (err) {
      setError(err.message);
      setPhase('signed-out');
    } finally {
      busy.current = false;
    }
  }, [primary, openSheet]);

  const createSheet = useCallback(async () => {
    setError(null);
    setPhase('loading');
    try {
      const id = await sheets.createSpreadsheet(primary);
      await openSheet(id, primary);
    } catch (err) {
      setError(err.message);
      setPhase('needs-sheet');
    }
  }, [primary, openSheet]);

  const openExistingSheet = useCallback((input) => {
    setError(null);
    return openSheet(sheets.parseSpreadsheetId(input), primary);
  }, [primary, openSheet]);

  // Settings → "Add account". Must be called from a click.
  const addAccount = useCallback(async () => {
    const profile = await auth.addAccount({ isPrimary: false });
    const list = parseAccounts(sheets.settings().accounts);
    if (list.some((a) => a.email === profile.email)) return profile;
    const used = new Set(list.map((a) => a.color));
    const color = ACCOUNT_COLORS.find((c) => !used.has(c)) || ACCOUNT_COLORS[list.length % ACCOUNT_COLORS.length];
    saveAccounts([...list, { email: profile.email, name: profile.name, color, editable: true, primary: false }]);
    return profile;
  }, []);

  // Inline "Reconnect" button. Must be called from a click.
  // Status updates arrive through onAuthChange.
  const reconnect = useCallback(async (email) => {
    try {
      await auth.connect(email, { isPrimary: email === primary, interactive: true });
      return true;
    } catch {
      return false;
    }
  }, [primary]);

  const updateAccount = useCallback((email, patch) => {
    saveAccounts(parseAccounts(sheets.settings().accounts).map((a) => (a.email === email ? { ...a, ...patch } : a)));
  }, []);

  const removeAccount = useCallback((email) => {
    if (email === primary) return;
    auth.disconnect(email);
    forgetAccount(email);
    saveAccounts(parseAccounts(sheets.settings().accounts).filter((a) => a.email !== email));
    setStatus((m) => { const n = { ...m }; delete n[email]; return n; });
  }, [primary]);

  const signOut = useCallback(async () => {
    await sheets.flush().catch(() => {});
    for (const a of parseAccounts(sheets.settings().accounts)) { auth.disconnect(a.email); forgetAccount(a.email); }
    if (primary) auth.disconnect(primary);
    auth.setWantedAccounts([]);
    LS.set(PRIMARY_KEY, null);
    LS.set(KNOWN_KEY, null);
    setPrimary(null);
    setStatus({});
    setPhase('signed-out');
  }, [primary]);

  const forgetSheet = useCallback(() => {
    LS.set(SHEET_KEY, null);
    setPhase('needs-sheet');
  }, []);

  function shiftMonth(delta) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  const value = {
    year, month, setYear, setMonth, shiftMonth,
    phase, error, primary, accounts, status,
    signIn, createSheet, openExistingSheet, addAccount, reconnect, finishConnecting,
    updateAccount, removeAccount, signOut, forgetSheet,
    sheetFromEnv: Boolean(import.meta.env.VITE_SHEET_ID),
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
