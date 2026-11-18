import { Check, Loader2, AlertTriangle } from 'lucide-react';
import * as sheets from '../lib/sheets.js';
import * as finance from '../lib/localdb.js';
import { useSheetData } from '../state.jsx';

// Small "Saving… / Saved / Retry" indicator covering both spreadsheet writes
// and the encrypted finance sync.
export default function SaveStatus() {
  useSheetData();
  const { saving, error } = sheets.getStatus();
  const fin = finance.getStatus();
  if (error) {
    return (
      <button className="save-status err" onClick={() => sheets.flush().catch(() => {})} title={error}>
        <AlertTriangle size={13} /> Not saved — retry
      </button>
    );
  }
  if (fin.error) {
    return (
      <button className="save-status err" onClick={() => finance.sync().catch(() => {})} title={fin.error}>
        <AlertTriangle size={13} /> Finances not synced — retry
      </button>
    );
  }
  if (saving || sheets.hasUnsaved() || finance.hasUnsynced()) {
    return <span className="save-status"><Loader2 size={13} className="spin" /> Saving…</span>;
  }
  return <span className="save-status ok"><Check size={13} /> Saved</span>;
}
