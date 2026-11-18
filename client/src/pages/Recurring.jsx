import { useState } from 'react';
import { Plus, Trash2, Sparkles, Check, X, CalendarClock } from 'lucide-react';
import { fmt } from '../lib/format.js';
import * as finance from '../lib/finance.js';
import { monthlyEquivalent as monthlyEquiv } from '../lib/recurring.js';
import { useSheetData } from '../state.jsx';
import { Modal } from '../components/ui.jsx';

const FREQS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

export default function Recurring() {
  useSheetData();
  const categories = finance.categories();
  const items = finance.recurringItems();
  const [dismissed, setDismissed] = useState(() => new Set());
  const suggestions = finance.recurringSuggestions().filter((s) => !dismissed.has(s.merchant_key));
  const [editing, setEditing] = useState(null);

  const catName = (id) => categories.find((c) => c.id === id)?.name || 'Uncategorized';

  function confirmSuggestion(s) {
    finance.saveRecurring({
      name: s.name, amount: s.amount, frequency: s.frequency,
      next_due: s.next_due, category_id: s.category_id, auto_detected: true,
    });
  }
  function save(payload, id) {
    finance.saveRecurring(payload, id);
    setEditing(null);
  }
  const del = (id) => finance.deleteRecurring(id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Recurring</h1>
          <p className="page-sub">For Bills and Subscriptions</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add</button>
      </div>

      {/* Detected suggestions */}
      {suggestions.length > 0 && (
        <div className="card" style={{ marginBottom: 24, borderColor: 'var(--accent)' }}>
          <div className="card-title"><Sparkles size={13} style={{ verticalAlign: -2 }} /> Detected from your transactions</div>
          {suggestions.map((s) => (
            <div key={s.merchant_key} className="list-row">
              <div style={{ flex: 1 }}>
                <strong>{s.name}</strong>
                <span className="tag" style={{ marginLeft: 8 }}>{s.frequency}</span>
                <span className={'confhint ' + (s.confidence === 'high' ? 'high' : 'medium')} style={{ marginLeft: 8 }}>
                  {s.occurrences}× · {s.confidence} confidence
                </span>
                <div className="faint" style={{ fontSize: 12 }}>≈ {fmt.money(s.amount)} · {catName(s.category_id)} · next {fmt.dateLong(s.next_due)}</div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => confirmSuggestion(s)}><Check size={14} /> Add</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setDismissed(new Set([...dismissed, s.merchant_key]))}>
                <X size={14} /> Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Confirmed recurring items */}
      <div className="card">
        <div className="card-title">Tracked recurring items</div>
        {items.length === 0 && <p className="muted">Nothing yet. Add manually, or confirm a detected item above.</p>}
        {items.map((i) => (
          <div key={i.id} className="list-row wrap-sm">
            <span className="cat-ico" style={{ marginRight: 4 }}><CalendarClock size={15} /></span>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8 }}>
                <strong>{i.name}</strong>
                <span className="tag">{i.frequency}</span>
                {i.auto_detected ? <span className="pill accent" style={{ fontSize: 11 }}>auto</span> : null}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                {catName(i.category_id)} · next due {i.next_due ? fmt.dateLong(i.next_due) : '—'} · ≈ {fmt.money(monthlyEquiv(i.amount, i.frequency))}/mo
              </div>
            </div>
            <div className="num" style={{ fontWeight: 700, marginRight: 12 }}>{fmt.money(i.amount)}</div>
            <button className="row-gear" style={{ opacity: 1 }} onClick={() => setEditing(i)}>Edit</button>
            <button className="row-gear" style={{ opacity: 1 }} onClick={() => del(i.id)} aria-label="Delete"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      {editing && (
        <RecurringModal item={editing} categories={categories}
          onClose={() => setEditing(null)} onSave={save}
          onDelete={editing.id ? () => { del(editing.id); setEditing(null); } : null} />
      )}
    </>
  );
}

function RecurringModal({ item, categories, onClose, onSave, onDelete }) {
  const leaves = categories.filter((c) => c.parent_id);
  const [f, setF] = useState({
    name: item.name || '', amount: item.amount ?? '', frequency: item.frequency || 'monthly',
    next_due: item.next_due || '', category_id: item.category_id || '',
  });
  return (
    <Modal title={item.id ? 'Edit recurring item' : 'Add recurring item'} onClose={onClose}>
      <div className="field"><label>Name</label>
        <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Amount</label>
          <input className="input num" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div className="field"><label>Frequency</label>
          <select className="select" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            {FREQS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></div>
        <div className="field"><label>Next due</label>
          <input className="input" type="date" value={f.next_due} onChange={(e) => setF({ ...f, next_due: e.target.value })} /></div>
        <div className="field"><label>Category</label>
          <select className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">— None —</option>
            {leaves.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        {onDelete ? <button className="btn btn-ghost danger" onClick={onDelete}>Delete</button> : <span />}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.name || f.amount === ''}
            onClick={() => onSave({ name: f.name, amount: Number(f.amount) || 0, frequency: f.frequency, next_due: f.next_due || null, category_id: f.category_id || null }, item.id)}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
