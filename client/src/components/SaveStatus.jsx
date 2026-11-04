import { Check, Loader2, AlertTriangle } from 'lucide-react';
import * as sheets from '../lib/sheets.js';
import { useSheetData } from '../state.jsx';

// Small "Saving… / Saved / Retry" indicator for batched sheet writes.
export default function SaveStatus() {
  useSheetData();
  const { saving, error } = sheets.getStatus();
  if (error) {
    return (
      <button className="save-status err" onClick={() => sheets.flush().catch(() => {})} title={error}>
        <AlertTriangle size={13} /> Not saved — retry
      </button>
    );
  }
  if (saving || sheets.hasUnsaved()) return <span className="save-status"><Loader2 size={13} className="spin" /> Saving…</span>;
  return <span className="save-status ok"><Check size={13} /> Saved to Sheets</span>;
}
