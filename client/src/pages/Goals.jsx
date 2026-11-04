import { useState } from 'react';
import { Plus, Trash2, Target, Quote, CalendarCheck, Check } from 'lucide-react';
import { fmt } from '../lib/format.js';
import * as finance from '../lib/finance.js';
import { useSheetData } from '../state.jsx';
import { Modal, ProgressBar } from '../components/ui.jsx';

export default function Goals() {
  useSheetData();
  const goals = finance.goals();
  const [editing, setEditing] = useState(null);

  function save(payload, id) {
    finance.saveGoal(payload, id);
    setEditing(null);
  }
  const del = (id) => finance.deleteGoal(id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Goals</h1>
          <p className="page-sub">Milestones with a projected finish line — and the "why" behind each.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add goal</button>
      </div>

      {goals.length === 0 && (
        <div className="card empty">
          <Target size={28} />
          <p>No goals yet. Emergency fund, vacation, house down payment — name your first milestone.</p>
          <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add goal</button>
        </div>
      )}

      <div className="grid grid-2">
        {goals.map((g) => {
          const done = g.progress >= 1;
          return (
            <div key={g.id} className="card goal-card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 16 }}>{g.name}</strong>
                    {done && <span className="pill pos"><Check size={12} /> reached</span>}
                    {g.priority > 0 && <span className="tag">priority {g.priority}</span>}
                  </div>
                </div>
                <div className="row" style={{ gap: 2 }}>
                  <button className="row-gear" style={{ opacity: 1 }} onClick={() => setEditing(g)}>Edit</button>
                  <button className="row-gear" style={{ opacity: 1 }} onClick={() => del(g.id)} aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              </div>

              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
                <span className="big-number num" style={{ fontSize: 24 }}>{fmt.money0(g.current_amount)}</span>
                <span className="muted num">of {fmt.money0(g.target_amount)}</span>
              </div>
              <ProgressBar value={g.progress} />
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                <span className="muted">{Math.round(g.progress * 100)}% · {fmt.money0(g.remaining)} to go</span>
                {g.target_date && <span className="faint">target {fmt.dateLong(g.target_date)}</span>}
              </div>

              {/* Projection */}
              <div className="goal-projection">
                <CalendarCheck size={14} />
                {done ? (
                  <span>Goal reached — nicely done.</span>
                ) : g.monthly_contribution > 0 ? (
                  <span>
                    At {fmt.money0(g.monthly_contribution)}/mo, done in <strong>{g.monthsToComplete} mo</strong>
                    {g.projectedDate ? ` (~${fmt.dateLong(g.projectedDate)})` : ''}
                    {g.onTrack === true && <span className="pill pos" style={{ marginLeft: 8 }}>on track</span>}
                    {g.onTrack === false && <span className="pill warn" style={{ marginLeft: 8 }}>behind target</span>}
                  </span>
                ) : (
                  <span className="faint">Set a monthly contribution to project a finish date.</span>
                )}
              </div>

              {/* "Why" — surfaced quietly */}
              {g.why && (
                <div className="goal-why"><Quote size={13} /> {g.why}</div>
              )}
            </div>
          );
        })}
      </div>

      {editing && <GoalModal goal={editing} onClose={() => setEditing(null)} onSave={save} onDelete={editing.id ? () => { del(editing.id); setEditing(null); } : null} />}
    </>
  );
}

function GoalModal({ goal, onClose, onSave, onDelete }) {
  const [f, setF] = useState({
    name: goal.name || '', target_amount: goal.target_amount ?? '', current_amount: goal.current_amount ?? '',
    monthly_contribution: goal.monthly_contribution ?? '', target_date: goal.target_date || '',
    priority: goal.priority ?? 0, account: goal.account || '', why: goal.why || '',
  });
  return (
    <Modal title={goal.id ? 'Edit goal' : 'Add goal'} onClose={onClose}>
      <div className="field"><label>Name</label>
        <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Target amount</label>
          <input className="input num" type="number" step="0.01" value={f.target_amount} onChange={(e) => setF({ ...f, target_amount: e.target.value })} /></div>
        <div className="field"><label>Saved so far</label>
          <input className="input num" type="number" step="0.01" value={f.current_amount} onChange={(e) => setF({ ...f, current_amount: e.target.value })} /></div>
        <div className="field"><label>Monthly contribution</label>
          <input className="input num" type="number" step="0.01" value={f.monthly_contribution} onChange={(e) => setF({ ...f, monthly_contribution: e.target.value })} /></div>
        <div className="field"><label>Target date</label>
          <input className="input" type="date" value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} /></div>
        <div className="field"><label>Priority (0–5)</label>
          <input className="input num" type="number" min="0" max="5" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></div>
        <div className="field"><label>Linked account</label>
          <input className="input" value={f.account} placeholder="e.g. Savings" onChange={(e) => setF({ ...f, account: e.target.value })} /></div>
      </div>
      <div className="field">
        <label><Quote size={12} /> Why this goal? <span className="faint">(optional — the point behind the number)</span></label>
        <textarea className="input" rows={2} value={f.why} placeholder="e.g. Six months of runway so I can take career risks without fear."
          onChange={(e) => setF({ ...f, why: e.target.value })} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        {onDelete ? <button className="btn btn-ghost danger" onClick={onDelete}>Delete</button> : <span />}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.name}
            onClick={() => onSave({
              name: f.name, target_amount: Number(f.target_amount) || 0, current_amount: Number(f.current_amount) || 0,
              monthly_contribution: Number(f.monthly_contribution) || 0, target_date: f.target_date || '',
              priority: Number(f.priority) || 0, account: f.account.trim(), why: f.why,
            }, goal.id)}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
