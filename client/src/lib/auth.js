// Google Identity Services token client, one OAuth token per connected Google
// account. Tokens live only in this module's memory — never in storage, never
// in the spreadsheet. Pages don't use this directly; the data layers
// (sheets.js, agenda.js) call authedFetch().
//
// Popups: browsers only allow a popup that opens synchronously inside a user
// tap, one per tap. So the GIS script is preloaded at startup (no await
// between the tap and window.open), and tokens about to expire are renewed
// during the user's next tap anywhere in the app (see onUserTap).

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const BASE_SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.events',
  // calendar.events alone can't list an account's calendars; this read-only
  // scope lets Home group events and the "new event" picker by calendar.
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/tasks',
];
const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  // Lets the Drive picker (picker.js) list and open an existing spreadsheet.
  'https://www.googleapis.com/auth/drive.file',
];

// Renew on the next tap once a token is this close to expiring.
const REFRESH_MARGIN = 10 * 60 * 1000;
// After a silent refresh fails (other than a blocked popup), wait before
// trying again on a tap, so a broken account doesn't flash a popup every tap.
const RETRY_AFTER = 60 * 1000;
// Silent-refresh errors that need the user to act (pick account, consent).
const NEEDS_USER = new Set(['interaction_required', 'wrong_account', 'scopes', 'denied']);

export const scopesFor = (isPrimary) =>
  (isPrimary ? [...BASE_SCOPES, ...SHEETS_SCOPES] : BASE_SCOPES).join(' ');

const tokens = new Map(); // email -> { accessToken, expiresAt, scope }
const pending = new Map(); // email -> Promise (dedupe concurrent refreshes)
const wanted = new Map(); // email -> isPrimary, for every account the app uses
const failures = new Map(); // email -> { at, code } of the last failed silent refresh
const listeners = new Set();

export class AuthError extends Error {
  constructor(message, { email, code } = {}) {
    super(message);
    this.name = 'AuthError';
    this.email = email;
    this.code = code; // 'popup_blocked' | 'interaction_required' | 'denied' | 'wrong_account' | 'scopes' | ...
  }
}

// state.jsx subscribes so account status stays right even when a token is
// renewed in the background.  fn(email, 'connecting' | 'ok' | 'error', error)
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (email, state, error) => listeners.forEach((fn) => fn(email, state, error));

const gisReady = () => Boolean(window.google?.accounts?.oauth2);
let gisPromise = null;
export function preload() {
  if (gisReady()) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

export const isConfigured = () => Boolean(CLIENT_ID);

// One token request through GIS. prompt:
//   'select_account' — Add account (user picks which Google account)
//   ''               — reconnect a known account (consent only if needed)
//   'none'           — silent refresh; fails instead of showing any UI
function requestToken(opts) {
  // Synchronous when GIS is loaded, so the popup opens inside the user's tap.
  if (gisReady()) return startRequest(opts);
  return preload().then(() => startRequest(opts));
}

function startRequest({ scope, prompt, hint }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(
      () => done(reject, new AuthError('Google sign-in timed out.', { email: hint, code: 'timeout' })),
      prompt === 'none' ? 20000 : 300000,
    );
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope,
      callback: (resp) => {
        if (resp.error) {
          const code = ['interaction_required', 'login_required', 'consent_required'].includes(resp.error)
            ? 'interaction_required' : 'denied';
          const msg = code === 'interaction_required' ? 'Google needs you to sign in again.' : (resp.error_description || resp.error);
          return done(reject, new AuthError(msg, { email: hint, code }));
        }
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, ...scope.split(' ').filter((s) => s.startsWith('https://')))) {
          return done(reject, new AuthError('Please allow all requested permissions (Calendar, Tasks and, for the primary account, Sheets and Drive).', { email: hint, code: 'scopes' }));
        }
        done(resolve, resp);
      },
      error_callback: (err) => {
        const code = err?.type === 'popup_failed_to_open' ? 'popup_blocked'
          : err?.type === 'popup_closed' ? 'closed' : 'unknown';
        const msg = code === 'popup_blocked' ? 'Sign-in popup was blocked. Tap Reconnect.'
          : code === 'closed' ? 'Sign-in was closed before finishing.' : 'Google sign-in failed.';
        done(reject, new AuthError(msg, { email: hint, code }));
      },
    });
    const opts = { prompt };
    if (hint) opts.login_hint = hint;
    client.requestAccessToken(opts);
  });
}

async function fetchProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Could not read Google profile.');
  return res.json(); // { email, name, picture, ... }
}

function store(email, resp) {
  tokens.set(email, {
    accessToken: resp.access_token,
    expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
    scope: resp.scope,
  });
  failures.delete(email);
}

// The accounts the app wants tokens for (primary first). Tap-to-refresh only
// considers these.
export function setWantedAccounts(list) {
  wanted.clear();
  for (const a of [...list].sort((x, y) => (y.primary ? 1 : 0) - (x.primary ? 1 : 0))) {
    wanted.set(a.email.toLowerCase(), !!a.primary);
  }
}

// Interactive: let the user choose a Google account. Returns its profile.
export async function addAccount({ isPrimary = false } = {}) {
  const resp = await requestToken({ scope: scopesFor(isPrimary), prompt: 'select_account' });
  const profile = await fetchProfile(resp.access_token);
  const email = profile.email.toLowerCase();
  if (!wanted.has(email)) wanted.set(email, isPrimary);
  store(email, resp);
  emit(email, 'ok');
  return { email, name: profile.name || email, picture: profile.picture || '' };
}

// Get a token for a known account. Must run inside a tap (interactive, or a
// silent refresh that still needs a popup to open).
export function connect(email, { isPrimary, interactive = false } = {}) {
  email = email.toLowerCase();
  if (isPrimary !== undefined) wanted.set(email, isPrimary);
  const primary = wanted.get(email) ?? false;
  if (pending.has(email)) return pending.get(email);
  emit(email, 'connecting');
  const p = requestToken({ scope: scopesFor(primary), prompt: interactive ? '' : 'none', hint: email })
    .then(async (resp) => {
      const profile = await fetchProfile(resp.access_token);
      if (profile.email.toLowerCase() !== email) {
        throw new AuthError(`Signed in as ${profile.email}, expected ${email}.`, { email, code: 'wrong_account' });
      }
      store(email, resp);
      emit(email, 'ok');
      return profile;
    })
    .catch((err) => {
      failures.set(email, { at: Date.now(), code: err.code });
      emit(email, 'error', err);
      throw err;
    })
    .finally(() => pending.delete(email));
  pending.set(email, p);
  return p;
}

export const hasToken = (email) => {
  const t = tokens.get(email?.toLowerCase());
  return Boolean(t && t.expiresAt - 60000 > Date.now());
};

async function getToken(email) {
  email = email.toLowerCase();
  if (hasToken(email)) return tokens.get(email).accessToken;
  // Expired or missing outside a tap: try silently. If the browser blocks it,
  // the account shows Reconnect, and the next tap anywhere retries it.
  await connect(email, { interactive: false });
  return tokens.get(email).accessToken;
}

// A current access token, for Google widgets (the Drive picker) that take one
// directly instead of going through authedFetch.
export const accessToken = (email) => getToken(email);

export function disconnect(email) {
  email = email.toLowerCase();
  const t = tokens.get(email);
  tokens.delete(email);
  wanted.delete(email);
  failures.delete(email);
  if (t && gisReady()) window.google.accounts.oauth2.revoke(t.accessToken, () => {});
}

// ---------------------------------------------------------------------------
// Refresh on the next tap
// ---------------------------------------------------------------------------
// Pick the one account (primary first) that most needs a token: missing or
// expiring within REFRESH_MARGIN, not already refreshing, and not stuck on an
// error only the user can fix (those keep their Reconnect button).
function nextToRefresh() {
  const now = Date.now();
  for (const email of wanted.keys()) {
    if (pending.has(email)) continue;
    const t = tokens.get(email);
    if (t && t.expiresAt - REFRESH_MARGIN > now) continue;
    const f = failures.get(email);
    if (f && NEEDS_USER.has(f.code)) continue;
    if (f && f.code !== 'popup_blocked' && now - f.at < RETRY_AFTER) continue;
    return email;
  }
  return null;
}

function onUserTap(e) {
  if (!CLIENT_ID || !gisReady()) return;
  // Buttons that open their own Google popup (Reconnect, Add account, sign
  // in) need this tap for themselves; one popup per tap.
  if (e.target?.closest?.('[data-auth-action]')) return;
  const email = nextToRefresh();
  if (email) connect(email, { interactive: false }).catch(() => {});
}

if (typeof document !== 'undefined') {
  // Capture phase: runs inside the tap before any page handler.
  document.addEventListener('click', onUserTap, true);
}

// fetch() as a given account. Retries once after a 401 with a fresh token.
export async function authedFetch(email, url, { method = 'GET', body, query } = {}) {
  const u = new URL(url);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(email);
    const res = await fetch(u, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) { tokens.delete(email.toLowerCase()); continue; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error?.message || `${res.status} ${res.statusText}`);
      e.status = res.status;
      e.email = email;
      throw e;
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }
  throw new AuthError('Session expired.', { email, code: 'expired' });
}
