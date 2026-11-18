import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Settings2, Lock, AlertTriangle, Check, Minus, Star } from 'lucide-react';
import { fmt } from '../lib/format.js';
import * as finance from '../lib/finance.js';
import { useApp, useSheetData } from '../state.jsx';
import { MonthPicker, ProgressBar, CatIcon, Modal } from '../components/ui.jsx';
import TransactionList from '../components/TransactionList.jsx';

const BUCKETS = ['needs', 'investing', 'wants'];
const URGENCY = ['urgent', 'important', 'neither'];

// Module-level so its identity is stable across Budget re-renders. If this were
// defined inside Budget, every keystroke would remount the row and the budget
// input would lose focus mid-edit. All state/handlers come in via `ctx`.
function BudgetRow({ c, isChild, ctx }) {
  const {
    childrenOf, expanded, setExpanded, renaming, setRenaming, renameCat,
    allocValue, allocWidth, setDrafts, saveAllocation, setEditCat,
  } = ctx;
  const over = c.overCap;
  const kids = !isChild ? childrenOf(c.id) : [];
  const isParent = kids.length > 0;
  const open = expanded[c.id];
  return (
    <>
      <div className={'budget-row' + (isChild ? ' child' : '')}>
        <div className="budget-cell name" style={{ paddingLeft: isChild ? 34 : 8 }}>
          {isParent ? (
            <button className="expander" onClick={() => setExpanded((e) => ({ ...e, [c.id]: !e[c.id] }))}
              aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : <span style={{ width: 16, display: 'inline-block' }} />}
          <span className="cat-ico"><CatIcon name={c.icon} /></span>
          {renaming === c.id ? (
            <input
              className="cat-rename" defaultValue={c.name} autoFocus
              onFocus={(e) => e.target.select()}
              onBlur={(e) => renameCat(c.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }}
            />
          ) : (
            <span className="cat-name" title={`${c.name} — double-click to rename`} onDoubleClick={() => setRenaming(c.id)}>{c.name}</span>
          )}
          {c.cap_type === 'hard' && (
            <span className="chip hard" title="Hard cap — flagged red when over"><Lock size={12} /></span>
          )}
          {c.urgency === 'urgent' && (
            <span className="chip urg-urgent" title="Urgent"><AlertTriangle size={12} /></span>
          )}
          {c.urgency === 'important' && (
            <span className="chip urg-important" title="Important"><Star size={12} /></span>
          )}
          <button className="row-gear" onClick={() => setEditCat(c)} aria-label={`Settings for ${c.name}`}>
            <Settings2 size={14} />
          </button>
        </div>

        <div className="budget-cell num budgeted">
          {isParent ? (
            <span className="muted">{fmt.money(c.budgeted)}</span>
          ) : (
            <input
              className="alloc-input num" type="number" step="1" placeholder="0"
              style={{ width: allocWidth(c) }}
              value={allocValue(c)}
              onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
              onBlur={(e) => saveAllocation(c.id, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          )}
        </div>

        <div className="budget-cell num">{fmt.money(c.actual)}</div>

        <div className="budget-cell num rem">
          <span className={over ? 'over-amt' : ''}>
            <span className="rem-icon">
              {over ? <AlertTriangle size={12} style={{ verticalAlign: -1 }} /> : c.remaining >= 0 ? <Check size={12} className="ok-ic" /> : <Minus size={12} />}
              {' '}
            </span>
            {fmt.money(Math.abs(c.remaining))}<span className="rem-word"> {over ? 'over' : 'left'}</span>
          </span>
        </div>

      </div>
      {isParent && open && kids.map((k) => <BudgetRow key={k.id} c={k} isChild ctx={ctx} />)}
    </>
  );
}

export default function Budget() {
  const { year, month } = useApp();
  useSheetData(); // recompute whenever the sheet cache changes
  const [expanded, setExpanded] = useState({});
  const [editCat, setEditCat] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [drafts, setDrafts] = useState({}); // local allocation edits
  const [renaming, setRenaming] = useState(null); // category id being renamed inline

  // Resizable columns — widths persist across reloads.
  const COL_MIN = { name: 140, budgeted: 80, actual: 80, remaining: 100 };
  const [cols, setCols] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('pfba.budgetCols')); if (s && s.name) return s; } catch { /* ignore */ }
    return { name: 300, budgeted: 130, actual: 110, remaining: 150 };
  });
  useEffect(() => { try { localStorage.setItem('pfba.budgetCols', JSON.stringify(cols)); } catch { /* ignore */ } }, [cols]);

  function startResize(e, key) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = cols[key];
    const move = (ev) => setCols((c) => ({ ...c, [key]: Math.max(COL_MIN[key], startW + (ev.clientX - startX)) }));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  }

  const data = finance.computeBudget(year, month);

  // Default: expand all parents on first load
  useEffect(() => {
    setExpanded((prev) => {
      if (Object.keys(prev).length) return prev;
      const next = {};
      data.categories.filter((c) => !c.parent_id).forEach((c) => { next[c.id] = true; });
      return next;
    });
  }, [data.categories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const parents = data.categories.filter((c) => !c.parent_id);
  const childrenOf = (pid) => data.categories.filter((c) => c.parent_id === pid);
  const zeroBased = Math.abs(data.leftToBudget) < 0.005;

  function saveAllocation(catId, value) {
    finance.setAllocation(year, month, catId, Number(value) || 0);
    setDrafts((d) => { const n = { ...d }; delete n[catId]; return n; });
  }

  const saveIncome = (value) => finance.setExpectedIncome(year, month, Number(value) || 0);
  const saveSplit = (next) => finance.setSplitPct(next);

  const allocValue = (c) => (c.id in drafts ? drafts[c.id] : c.ownBudgeted || '');

  function renameCat(id, name) {
    setRenaming(null);
    const trimmed = (name || '').trim();
    const cur = data.categories.find((c) => c.id === id);
    if (!trimmed || (cur && trimmed === cur.name)) return;
    finance.updateCategory(id, { name: trimmed });
  }

  // Budget input grows with the number: starts compact, widens to fit every
  // digit (plus a comma-grouping/decimal buffer) with no clipping.
  const allocWidth = (c) => {
    const len = String(allocValue(c) || '').length;
    const chars = Math.max(3, Math.min(16, len + 1));
    return `calc(${chars}ch + 24px)`;
  };

  // Handlers/state handed to the stable module-level BudgetRow.
  const rowCtx = {
    childrenOf, expanded, setExpanded, renaming, setRenaming, renameCat,
    allocValue, allocWidth, setDrafts, saveAllocation, setEditCat,
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Budget</h1>
        </div>
        <MonthPicker />
      </div>

      <div className="budget-layout">
        <div>
          {/* Left-to-budget — its own prominent card, never buried in the table */}
          <div className={'card ltb-card' + (zeroBased ? ' good' : '')}>
            <div>
              <div className="card-title" style={{ margin: 0 }}>Left to Budget</div>
              <div className="big-number num" style={{ color: zeroBased ? 'var(--pos)' : data.leftToBudget < 0 ? 'var(--neg)' : 'var(--text)' }}>
                {fmt.money(data.leftToBudget)}
              </div>
              {!zeroBased && (
                <div className="metric-label">
                  {data.leftToBudget > 0 ? 'Assign the rest to an envelope' : 'Over-assigned — pull back somewhere'}
                </div>
              )}
            </div>
            <div className="ltb-income">
              <label className="metric-label">Expected income</label>
              <input key={`${year}-${month}`} className="input num" type="number" step="1" defaultValue={data.expectedIncome || ''}
                placeholder={data.actualIncome ? String(data.actualIncome) : '0'}
                onBlur={(e) => saveIncome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
              <div className="faint" style={{ fontSize: 11 }}>
                Assigned {fmt.money(data.totalBudgeted)} of {fmt.money(data.incomeBase)}
              </div>
            </div>
          </div>

          {/* Envelope table — drag the header dividers to resize columns;
              double-click a category name to rename it. */}
          <div className="card budget-card" style={{
            '--col-name': cols.name + 'px', '--col-budgeted': cols.budgeted + 'px',
            '--col-actual': cols.actual + 'px', '--col-remaining': cols.remaining + 'px',
          }}>
            <div className="budget-table">
              <div className="budget-row head">
                <div className="budget-cell name">Category<span className="col-resize" onMouseDown={(e) => startResize(e, 'name')} title="Drag to resize" /></div>
                <div className="budget-cell num">Budgeted<span className="col-resize" onMouseDown={(e) => startResize(e, 'budgeted')} title="Drag to resize" /></div>
                <div className="budget-cell num">Actual<span className="col-resize" onMouseDown={(e) => startResize(e, 'actual')} title="Drag to resize" /></div>
                <div className="budget-cell num rem">Remaining<span className="col-resize" onMouseDown={(e) => startResize(e, 'remaining')} title="Drag to resize" /></div>
              </div>
              {parents.map((p) => <BudgetRow key={p.id} c={p} ctx={rowCtx} />)}
              <div style={{ padding: 12 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}>
                  <Plus size={15} /> Add category
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right summary rail */}
        <aside className="rail">
          <div className="card">
            <div className="card-title">Safe to Spend</div>
            <div className="big-number num" style={{ fontSize: 28 }}>{fmt.money(data.safeToSpend)}</div>
            <div className="metric-label">Income base − actual spend</div>
            {data.committedRecurring > 0 && (
              <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                {fmt.money(data.safeToSpendCommitted)} after envelopes and {fmt.money(data.committedRecurring)}/mo recurring
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">Buckets vs. target</div>
            {BUCKETS.map((b) => {
              const bk = data.buckets[b];
              const diff = bk.budgeted - bk.targetAmount;
              const onTarget = Math.abs(diff) < 1;
              return (
                <div key={b} className="rail-bucket">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ textTransform: 'capitalize' }}>{b}</strong>
                    <span className="tag">{bk.targetPct}%</span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                    <span className="muted num">{fmt.money(bk.budgeted)} budgeted</span>
                    <span className={'confhint ' + (onTarget ? 'high' : 'medium')}>
                      {onTarget ? 'on target' : diff > 0 ? `+${fmt.money0(diff)}` : fmt.money0(diff)}
                    </span>
                  </div>
                  <ProgressBar value={bk.targetAmount > 0 ? bk.budgeted / bk.targetAmount : 0} warn={diff > 1} />
                </div>
              );
            })}
          </div>

          {/* Editable split */}
          <div className="card">
            <div className="card-title">Split percentages</div>
            <SplitEditor value={data.splitPct} onSave={saveSplit} />
          </div>
        </aside>
      </div>

      {/* The transactions this month's budget is built from */}
      <TransactionList year={year} month={month} categories={data.categories} />

      {addOpen && (
        <CategoryModal
          title="Add category"
          parents={parents}
          onClose={() => setAddOpen(false)}
          onSave={(payload) => {
            finance.addCategory(payload);
            setAddOpen(false);
          }}
        />
      )}

      {editCat && (
        <CategoryModal
          title={`Edit “${editCat.name}”`}
          parents={parents}
          initial={editCat}
          onClose={() => setEditCat(null)}
          onDelete={() => {
            finance.archiveCategory(editCat.id);
            setEditCat(null);
          }}
          onSave={(payload) => {
            finance.updateCategory(editCat.id, payload);
            setEditCat(null);
          }}
        />
      )}
    </>
  );
}

function SplitEditor({ value, onSave }) {
  const [v, setV] = useState(value);
  const total = Number(v.needs) + Number(v.investing) + Number(v.wants);
  const valid = Math.abs(total - 100) < 0.01;
  return (
    <div>
      {BUCKETS.map((b) => (
        <div key={b} className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <label style={{ textTransform: 'capitalize' }}>{b}</label>
          <div className="row" style={{ gap: 4 }}>
            <input className="input num" style={{ width: 64 }} type="number" value={v[b]}
              onChange={(e) => setV({ ...v, [b]: e.target.value })} />
            <span className="faint">%</span>
          </div>
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className={valid ? 'confhint high' : 'confhint low'}>Total {total}%{valid ? '' : ' — must be 100'}</span>
        <button className="btn btn-primary btn-sm" disabled={!valid} onClick={() => onSave(v)}>Apply</button>
      </div>
    </div>
  );
}

function CategoryModal({ title, parents, initial, onClose, onSave, onDelete }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    parent_id: initial?.parent_id || '',
    bucket: initial?.bucket || 'needs',
    cap_type: initial?.cap_type || 'soft',
    urgency: initial?.urgency || 'neither',
    icon: initial?.icon || 'Circle',
  });
  return (
    <Modal title={title} onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input className="input" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Parent group</label>
          <select className="select" value={f.parent_id || ''} onChange={(e) => setF({ ...f, parent_id: e.target.value || null })}>
            <option value="">— Top level —</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Bucket</label>
          <select className="select" value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value })}>
            {BUCKETS.map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Envelope strictness</label>
          <select className="select" value={f.cap_type} onChange={(e) => setF({ ...f, cap_type: e.target.value })}>
            <option value="soft">Soft cap (warn only)</option>
            <option value="hard">Hard cap (flag red when over)</option>
          </select>
        </div>
        <div className="field">
          <label>Urgency / importance</label>
          <select className="select" value={f.urgency || 'neither'} onChange={(e) => setF({ ...f, urgency: e.target.value })}>
            {URGENCY.map((u) => <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
        {onDelete ? <button className="btn btn-ghost danger" onClick={onDelete}>Delete</button> : <span />}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.name}
            onClick={() => onSave({ ...f, urgency: f.urgency === 'neither' ? null : f.urgency, parent_id: f.parent_id || null })}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
