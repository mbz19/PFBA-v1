import { useEffect, useState } from 'react';
import { UserPlus, RefreshCw, Trash2, ExternalLink, LogOut, Star, Download, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useApp, useSheetData } from '../state.jsx';
import * as sheets from '../lib/sheets.js';
import * as finance from '../lib/localdb.js';
import { AccountDot } from '../components/ui.jsx';

export default function Settings() {
  const {
    accounts, status, addAccount, reconnect, updateAccount, removeAccount,
    signOut, forgetSheet, sheetFromEnv,
  } = useApp();
  const [error, setError] = useState('');
  const [reloading, setReloading] = useState(false);

  async function onAdd() {
    setError('');
    try { await addAccount(); } catch (err) { setError(err.message); }
  }

  async function onReload() {
    setReloading(true);
    try { await sheets.reload(); } catch (err) { setError(err.message); } finally { setReloading(false); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Connected Google accounts and where your data lives.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Google accounts</div>
          <button data-auth-action className="btn btn-primary btn-sm" onClick={onAdd}><UserPlus size={14} /> Add account</button>
        </div>
        <p className="faint" style={{ marginTop: 0, fontSize: 12 }}>
          Home shows Calendar and Tasks from every account. The primary account also owns the spreadsheet.
          Sign-in tokens are kept in memory only and never saved.
        </p>
        {error && <div className="pill neg" style={{ marginBottom: 12, whiteSpace: 'normal' }}>{error}</div>}

        {accounts.map((a) => {
          const st = status[a.email]?.state;
          return (
            <div key={a.email} className="acct-row">
              <label className="color-pick" title="Account color">
                <AccountDot color={a.color} size={14} title="Change color" />
                <input type="color" value={a.color || '#5185bf'} onChange={(e) => updateAccount(a.email, { color: e.target.value })} />
              </label>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input className="input acct-name" value={a.name || ''} aria-label={`Display name for ${a.email}`}
                  onChange={(e) => updateAccount(a.email, { name: e.target.value })} />
                <div className="faint acct-email">
                  {a.email}
                  {a.primary && <span className="pill accent" style={{ marginLeft: 6, fontSize: 11 }}><Star size={10} /> primary</span>}
                  {st === 'ok' && <span className="pill pos" style={{ marginLeft: 6, fontSize: 11 }}>connected</span>}
                  {st === 'connecting' && <span className="pill neutral" style={{ marginLeft: 6, fontSize: 11 }}>connecting…</span>}
                  {st === 'error' && <span className="pill neg" style={{ marginLeft: 6, fontSize: 11 }} title={status[a.email]?.error?.message}>needs reconnect</span>}
                  {(st === 'idle' || !st) && <span className="pill neutral" style={{ marginLeft: 6, fontSize: 11 }}>not connected</span>}
                </div>
              </div>
              <div className="acct-actions">
                {!a.primary && (
                  <label className="row" style={{ gap: 6, fontSize: 12 }} title="Allow creating and editing events/tasks in this account">
                    <span className="switch">
                      <input type="checkbox" checked={a.editable !== false} onChange={(e) => updateAccount(a.email, { editable: e.target.checked })} />
                      <span className="slider" />
                    </span>
                    Editable
                  </label>
                )}
                {st !== 'ok' && (
                  <button data-auth-action className="btn btn-sm" disabled={st === 'connecting'} onClick={() => reconnect(a.email)}>
                    <RefreshCw size={13} /> Reconnect
                  </button>
                )}
                {!a.primary && (
                  <button className="btn btn-sm btn-danger" onClick={() => confirm(`Remove ${a.email}?`) && removeAccount(a.email)} aria-label={`Remove ${a.email}`}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Spreadsheet</div>
        <p style={{ marginTop: 0, wordBreak: 'break-all' }}>
          <a href={sheets.spreadsheetUrl()} target="_blank" rel="noreferrer">
            Open in Google Sheets <ExternalLink size={12} />
          </a>
          <br /><span className="faint" style={{ fontSize: 12 }}>ID: {sheets.getSpreadsheetId()}</span>
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={onReload} disabled={reloading}>
            <RefreshCw size={13} /> {reloading ? 'Reloading…' : 'Reload from sheet'}
          </button>
          {!sheetFromEnv && (
            <button className="btn btn-sm btn-ghost" onClick={forgetSheet}>Use a different spreadsheet</button>
          )}
        </div>
        <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
          Edited the sheet directly? Reload to pull in your changes. Tip: set this ID as the VITE_SHEET_ID repo variable so every device opens it automatically.
        </p>
      </div>

      <FinanceCard />

      <button className="btn" onClick={signOut}><LogOut size={15} /> Sign out</button>
    </>
  );
}

function save(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Where finance data lives, sync status, backups, and cleanup of the finance
// tabs left in the spreadsheet from before the vault.
function FinanceCard() {
  useSheetData(); // re-render on sync status changes
  const { syncing, error, lastSync } = finance.getStatus();
  const [legacy, setLegacy] = useState([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    sheets.legacyFinanceTabs().then((p) => setLegacy(p.map((t) => t.title))).catch(() => {});
  }, []);

  async function run(label, fn) {
    setBusy(label);
    setMsg('');
    try { await fn(); } catch (err) { setMsg(err.message || 'Something went wrong.'); } finally { setBusy(''); }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const removeLegacy = () => confirm(
    'Delete the finance tabs from your Google Sheet? Check that your budget, transactions, recurring bills and goals look right in the app first. This can\'t be undone.',
  ) && run('legacy', async () => { await sheets.deleteLegacyFinance(); setLegacy([]); });
  const forget = () => confirm(
    'Remove your finances from this device? Your encrypted copy in Google Drive stays, and you\'ll need your passphrase to unlock them here again.',
  ) && run('forget', async () => { await finance.sync().catch(() => {}); await finance.forgetDevice(); window.location.reload(); });
  const exportPlain = () => confirm(
    'This downloads an UNENCRYPTED copy anyone with the file can read. Continue?',
  ) && save(finance.exportSqlite(), `pfba-finance-${stamp}.sqlite`);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-title"><ShieldCheck size={15} /> Finances</div>
      <p style={{ marginTop: 0 }}>
        Budget, transactions, recurring bills and goals are stored in SQLite on this device and synced
        end-to-end encrypted through a hidden app folder in your Google Drive. Google can't read them.
      </p>
      <p className="muted" style={{ fontSize: 13 }}>
        {syncing ? 'Syncing…'
          : error ? <span className="over-amt">Sync failed: {error}</span>
          : lastSync ? `Last synced ${new Date(lastSync).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
          : 'Not synced yet'}
        {finance.hasUnsynced() && !syncing && ' · changes waiting to sync'}
      </p>
      {legacy.length > 0 && (
        <div className="acct-error" style={{ alignItems: 'flex-start' }}>
          <AlertTriangle size={15} style={{ marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Old finance tabs are still in your spreadsheet</strong>
            <div className="faint acct-error-msg">{legacy.join(', ')}: Google can read these. Their data has been moved into your encrypted vault.</div>
          </div>
          <button className="btn btn-sm" disabled={!!busy} onClick={removeLegacy}>
            <Trash2 size={13} /> {busy === 'legacy' ? 'Removing…' : 'Remove from sheet'}
          </button>
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn btn-sm" disabled={!!busy || syncing} onClick={() => run('sync', finance.sync)}>
          <RefreshCw size={13} /> Sync now
        </button>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => run('enc', async () => save(await finance.exportEncrypted(), `pfba-finance-${stamp}.vault`))}>
          <Download size={13} /> Encrypted backup
        </button>
        <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={exportPlain}>
          <Download size={13} /> Unencrypted SQLite file
        </button>
        <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={forget}>
          {busy === 'forget' ? 'Removing…' : 'Forget on this device'}
        </button>
      </div>
      {msg && <div className="pill neg" style={{ marginTop: 12, whiteSpace: 'normal' }}>{msg}</div>}
    </div>
  );
}
