import { useState, useEffect } from 'react';
import { Command, LogIn, FilePlus2, Link2, Check, Loader2, ArrowRight, FolderOpen } from 'lucide-react';
import { useApp, knownAccounts } from '../state.jsx';
import { isConfigured } from '../lib/auth.js';
import { isPickerConfigured, preloadPicker, pickSpreadsheet } from '../lib/picker.js';
import { AccountDot } from './ui.jsx';

// Everything before the app is usable: sign in with the primary Google
// account, pick (or create) the spreadsheet, then connect any other accounts
// with one tap each. Buttons that open a Google popup carry data-auth-action
// so the background tap-to-refresh leaves that tap to them.
export default function Gate() {
  const { phase, error, primary, signIn, createSheet, openExistingSheet, signOut } = useApp();
  const [sheetInput, setSheetInput] = useState('');
  const canPick = isPickerConfigured();
  const [showPaste, setShowPaste] = useState(!canPick);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState(null);
  const remembered = knownAccounts();

  // Load the picker while the user reads the screen so the button opens it fast.
  useEffect(() => {
    if (phase === 'needs-sheet' && canPick) preloadPicker().catch(() => {});
  }, [phase, canPick]);

  const chooseFromDrive = async () => {
    setPickError(null);
    setPicking(true);
    try {
      const doc = await pickSpreadsheet(primary);
      if (doc) await openExistingSheet(doc.id);
    } catch (err) {
      setPickError(err.message);
    } finally {
      setPicking(false);
    }
  };
  const others = remembered.filter((a) => a.email !== primary);
  const me = remembered.find((a) => a.email === primary);

  return (
    <div className="gate">
      <div className="card gate-card">
        <div className="brand" style={{ padding: 0, marginBottom: 16 }}>
          <span className="dot"><Command size={16} /></span>
          Command Center
        </div>

        {!isConfigured() && (
          <div className="pill neg" style={{ marginBottom: 12, whiteSpace: 'normal' }}>
            VITE_GOOGLE_CLIENT_ID is not set. See the README to create an OAuth client.
          </div>
        )}

        {(phase === 'signed-out' || phase === 'signing-in') && (
          <>
            <h2 style={{ margin: '0 0 8px' }}>{primary ? 'Welcome back' : 'Sign in'}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Your data lives in your own Google Sheet. Calendar and Tasks come straight from Google.
            </p>
            <button data-auth-action className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
              disabled={phase === 'signing-in' || !isConfigured()} onClick={() => signIn()}>
              <LogIn size={16} /> {phase === 'signing-in' ? 'Waiting for Google…' : primary ? `Continue as ${me?.name || primary}` : 'Sign in with Google'}
            </button>

            {primary && others.length > 0 && (
              <div className="remembered">
                <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Remembered on this device</div>
                {remembered.map((a) => (
                  <div key={a.email} className="remembered-row">
                    <AccountDot color={a.color} title={a.email} />
                    <span className="remembered-name">{a.name || a.email}</span>
                    <span className="faint remembered-email">{a.email}</span>
                    {a.email === primary && <span className="pill accent" style={{ fontSize: 11 }}>primary</span>}
                  </div>
                ))}
                <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                  After you sign in, connecting the other {others.length === 1 ? 'account takes one more tap' : `${others.length} accounts takes one tap each`}.
                </div>
              </div>
            )}

            {primary && phase === 'signed-out' && (
              <button data-auth-action className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => signIn({ switchAccount: true })}>
                Use a different primary account
              </button>
            )}
          </>
        )}

        {phase === 'needs-sheet' && (
          <>
            <h2 style={{ margin: '0 0 8px' }}>Choose your spreadsheet</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Signed in as <strong>{primary}</strong>. Create a new spreadsheet for your data, or choose one you already use (do this on each new device).
            </p>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={createSheet}>
              <FilePlus2 size={16} /> Create a new spreadsheet
            </button>
            <div className="gate-or">or</div>
            {canPick && (
              <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={picking}
                onClick={chooseFromDrive}>
                {picking ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />} Choose from Google Drive
              </button>
            )}
            {pickError && <div className="pill neg" style={{ marginTop: 8, whiteSpace: 'normal' }}>{pickError}</div>}
            {canPick && !showPaste && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setShowPaste(true)}>
                <Link2 size={14} /> Paste a link instead
              </button>
            )}
            {showPaste && (
              <div style={canPick ? { marginTop: 12 } : undefined}>
                <div className="field">
                  <label>Existing spreadsheet link or ID</label>
                  <input className="input" value={sheetInput} placeholder="https://docs.google.com/spreadsheets/d/…"
                    onChange={(e) => setSheetInput(e.target.value)} />
                </div>
                <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={!sheetInput.trim()}
                  onClick={() => openExistingSheet(sheetInput)}>
                  <Link2 size={16} /> Use this spreadsheet
                </button>
              </div>
            )}
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={signOut}>Sign out</button>
          </>
        )}

        {phase === 'loading' && <div className="spinner">Loading your spreadsheet…</div>}

        {phase === 'connect-accounts' && <ConnectAccounts />}

        {error && <div className="pill neg" style={{ marginTop: 12, whiteSpace: 'normal' }}>{error}</div>}
      </div>
    </div>
  );
}

// One tap per secondary account (browsers allow one popup per tap). Moves on
// to the app automatically once every account is connected.
function ConnectAccounts() {
  const { accounts, status, reconnect, finishConnecting } = useApp();
  const secondaries = accounts.filter((a) => !a.primary);
  const allDone = secondaries.every((a) => status[a.email]?.state === 'ok');
  const next = secondaries.find((a) => status[a.email]?.state !== 'ok' && status[a.email]?.state !== 'connecting');

  useEffect(() => {
    if (allDone) {
      const t = setTimeout(finishConnecting, 400);
      return () => clearTimeout(t);
    }
  }, [allDone, finishConnecting]);

  return (
    <>
      <h2 style={{ margin: '0 0 8px' }}>Connect your other accounts</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Tap each account once. If you've used it here before, Google's window closes on its own.
      </p>
      {secondaries.map((a) => {
        const st = status[a.email]?.state;
        const err = status[a.email]?.error;
        return (
          <div key={a.email} className="connect-row">
            <AccountDot color={a.color} title={a.email} size={11} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="remembered-name">{a.name || a.email}</div>
              <div className="faint remembered-email">{st === 'error' && err ? err.message : a.email}</div>
            </div>
            {st === 'ok' ? (
              <span className="pill pos"><Check size={12} /> Connected</span>
            ) : st === 'connecting' ? (
              <span className="pill neutral"><Loader2 size={12} className="spin" /> Connecting</span>
            ) : (
              <button data-auth-action className={'btn btn-sm' + (a === next ? ' btn-primary' : '')}
                onClick={() => reconnect(a.email)}>
                {st === 'error' ? 'Try again' : 'Connect'}
              </button>
            )}
          </div>
        );
      })}
      <button data-auth-action className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={finishConnecting}>
        {allDone ? 'Continue' : 'Skip for now'} <ArrowRight size={14} />
      </button>
    </>
  );
}
