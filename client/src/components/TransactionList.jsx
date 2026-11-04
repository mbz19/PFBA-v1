import { useState } from 'react';
import { Plus, Trash2, Split, X, Tag } from 'lucide-react';
import { fmt, isoDate } from '../lib/format.js';
import * as finance from '../lib/finance.js';
import { Modal, CatIcon } from './ui.jsx';

// The month's transactions, shown under the budget they feed. Ported from the
// old Transactions page; data now comes from the Transactions sheet tab.
export default function TransactionList({ year, month, categories }) {
  const [editing, setEditing] = useState(null);
  const txns = finance.transactions({ month: finance.monthKey(year, month) });
  const knownAccounts = [...new Set(finance.transactions().map((t) => t.account).filter(Boolean))].sort();

  const cat = (id) => categories.find((c) => c.id === id);

  // Group by date
  const groups = {};
  for (const t of txns) (groups[t.date] ||= []).push(t);
  const dates = Object.keys(groups).sort().reverse();

  const total = txns.reduce((s, t) => s + (t.is_income ? 0 : -t.amount), 0);

  return (
    <section style={{ marginTop: 32 }}>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 className="section-title">Transactions</h2>
          <p className="page-sub">{txns.length} this month · {fmt.money(total)} spent</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add</button>
      </div>

      {dates.length === 0 && (
        <div className="card empty">
          <p>No transactions yet for this month.</p>
          <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add one</button>
        </div>
      )}

      {dates.map((d) => (
        <div key={d} className="card txn-group">
          <div className="txn-date">{fmt.dateLong(d)}</div>
          {groups[d].map((t) => (
            <div key={t.id} className="txn-row" onClick={() => setEditing(t)}>
              <span className="cat-ico">
                <CatIcon name={cat(t.splits[0]?.category_id)?.icon || 'Circle'} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="txn-merchant">{t.merchant || t.description || '(no merchant)'}</div>
                <div className="txn-cat">
                  {t.splits.length > 1
                    ? <><Split size={11} /> {t.splits.length}-way split</>
                    : t.is_income ? 'Income' : cat(t.splits[0]?.category_id)?.name || 'Uncategorized'}
                  {t.account && <span className="faint"> · {t.account}</span>}
                  {t.tags.map((tg) => <span key={tg} className="tag" style={{ marginLeft: 6 }}>{tg}</span>)}
                </div>
              </div>
              <div className={'txn-amt num ' + (t.is_income ? 'pos' : '')}>
                {t.is_income ? '+' : '−'}{fmt.money0(Math.abs(t.amount))}
              </div>
              <button className="row-gear" onClick={(e) => { e.stopPropagation(); finance.deleteTransaction(t.id); }} aria-label="Delete">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      ))}

      {editing && (
        <TxnModal
          txn={editing}
          categories={categories}
          knownAccounts={knownAccounts}
          defaultDate={editing.id ? null : defaultDateFor(year, month)}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </section>
  );
}

// New transactions default to today, or the 1st when viewing another month.
function defaultDateFor(year, month) {
  const today = isoDate();
  return today.slice(0, 7) === finance.monthKey(year, month) ? today : `${finance.monthKey(year, month)}-01`;
}

function TxnModal({ txn, categories, knownAccounts, defaultDate, onClose, onSaved }) {
  const isEdit = !!txn.id;
  const leaves = categories.filter((c) => c.parent_id);
  const [f, setF] = useState({
    date: txn.date || defaultDate || isoDate(),
    amount: txn.amount != null ? Math.abs(txn.amount) : '',
    merchant: txn.merchant || '',
    account: txn.account || '',
    notes: txn.notes || '',
    is_income: !!txn.is_income,
    tags: (txn.tags || []).join(', '),
  });
  const [splits, setSplits] = useState(
    txn.splits && txn.splits.length
      ? txn.splits.map((s) => ({ category_id: s.category_id || '', amount: Math.abs(s.amount) }))
      : [{ category_id: '', amount: '' }]
  );
  const [split, setSplit] = useState((txn.splits?.length || 0) > 1);
  const [error, setError] = useState('');

  const total = Number(f.amount) || 0;
  const splitSum = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  function save() {
    setError('');
    if (!f.amount || Number.isNaN(Number(f.amount))) return setError('Enter an amount.');
    const payload = {
      date: f.date, amount: Number(f.amount), merchant: f.merchant,
      account: f.account.trim(), notes: f.notes, is_income: f.is_income,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    };
    if (!f.is_income && split) {
      if (Math.abs(splitSum - total) > 0.01) return setError(`Splits must total ${fmt.money(total)} (currently ${fmt.money(splitSum)}).`);
      payload.splits = splits.map((s) => ({ category_id: s.category_id || null, amount: Number(s.amount) }));
    } else {
      payload.category_id = f.is_income ? null : (splits[0]?.category_id || null);
    }
    finance.saveTransaction(payload, txn.id);
    onSaved();
  }

  return (
    <Modal title={isEdit ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      <div className="row" style={{ gap: 16, marginBottom: 12 }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="radio" checked={!f.is_income} onChange={() => setF({ ...f, is_income: false })} /> Expense
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="radio" checked={f.is_income} onChange={() => setF({ ...f, is_income: true })} /> Income
        </label>
      </div>

      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Amount</label>
          <input className="input num" type="number" inputMode="decimal" step="0.01" value={f.amount} autoFocus
            onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </div>
        <div className="field">
          <label>Date</label>
          <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </div>
      </div>

      <div className="field">
        <label>{f.is_income ? 'Source' : 'Merchant'}</label>
        <input className="input" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} />
      </div>

      {!f.is_income && !split && (
        <div className="field">
          <label>Category</label>
          <select className="select" value={splits[0]?.category_id || ''}
            onChange={(e) => setSplits([{ ...splits[0], category_id: e.target.value }])}>
            <option value="">— Uncategorized —</option>
            {leaves.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.bucket}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
            onClick={() => { setSplit(true); if (splits.length < 2) setSplits([{ category_id: splits[0]?.category_id || '', amount: f.amount || '' }, { category_id: '', amount: '' }]); }}>
            <Split size={14} /> Split across categories
          </button>
        </div>
      )}

      {!f.is_income && split && (
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label>Splits</label>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSplit(false); setSplits([{ category_id: splits[0]?.category_id || '', amount: '' }]); }}>
              <X size={13} /> Single category
            </button>
          </div>
          {splits.map((s, i) => (
            <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
              <select className="select" value={s.category_id} style={{ minWidth: 0 }}
                onChange={(e) => setSplits(splits.map((x, j) => j === i ? { ...x, category_id: e.target.value } : x))}>
                <option value="">— Category —</option>
                {leaves.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="input num" style={{ width: 100, flexShrink: 0 }} type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={s.amount}
                onChange={(e) => setSplits(splits.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              {splits.length > 1 && (
                <button className="row-gear always" onClick={() => setSplits(splits.filter((_, j) => j !== i))} aria-label="Remove split">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSplits([...splits, { category_id: '', amount: '' }])}>
              <Plus size={13} /> Add split
            </button>
            <span className={Math.abs(splitSum - total) < 0.01 ? 'confhint high' : 'confhint low'}>
              {fmt.money(splitSum)} of {fmt.money(total)}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Account</label>
          <input className="input" list="pfba-known-accounts" value={f.account} placeholder="e.g. Checking"
            onChange={(e) => setF({ ...f, account: e.target.value })} />
          <datalist id="pfba-known-accounts">
            {knownAccounts.map((a) => <option key={a} value={a} />)}
          </datalist>
        </div>
        <div className="field">
          <label><Tag size={12} /> Tags (comma-separated)</label>
          <input className="input" value={f.tags} placeholder="impulse, work…" onChange={(e) => setF({ ...f, tags: e.target.value })} />
        </div>
      </div>

      <div className="field">
        <label>Notes</label>
        <input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>

      {error && <div className="pill neg" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{isEdit ? 'Save changes' : 'Add transaction'}</button>
      </div>
    </Modal>
  );
}
