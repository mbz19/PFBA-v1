import { useState } from 'react';
import { UserPlus, RefreshCw, Trash2, ExternalLink, LogOut, Star } from 'lucide-react';
import { useApp } from '../state.jsx';
import * as sheets from '../lib/sheets.js';
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
                <input type="color" value={a.color || '#4f46e5'} onChange={(e) => updateAccount(a.email, { color: e.target.value })} />
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

      <button className="btn" onClick={signOut}><LogOut size={15} /> Sign out</button>
    </>
  );
}
