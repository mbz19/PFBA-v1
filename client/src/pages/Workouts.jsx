import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Dumbbell, Pencil } from 'lucide-react';
import * as workouts from '../lib/workouts.js';
import { useSheetData } from '../state.jsx';
import { Modal } from '../components/ui.jsx';

const LAST_KEY = 'pfba.workouts.selected';

// Each workout is a tab in the spreadsheet; its rows are the exercises.
export default function Workouts() {
  useSheetData();
  const list = workouts.list();
  const [selected, setSelected] = useState(() => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } });
  const [naming, setNaming] = useState(null); // { tab? } for create/rename
  const [error, setError] = useState('');

  const current = list.find((w) => w.tab === selected) || list[0];
  const select = (tab) => { setSelected(tab); try { localStorage.setItem(LAST_KEY, tab); } catch { /* ignore */ } };

  async function saveName(name) {
    setError('');
    try {
      const tab = naming.tab ? await workouts.rename(naming.tab, name) : await workouts.create(name);
      select(tab);
      setNaming(null);
    } catch (err) { setError(err.message); }
  }

  async function removeWorkout(w) {
    if (!confirm(`Delete the "${w.name}" workout and its tab in the spreadsheet?`)) return;
    try { await workouts.remove(w.tab); } catch (err) { setError(err.message); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Workouts</h1>
        </div>
        <button className="btn btn-primary" onClick={() => { setError(''); setNaming({}); }}><Plus size={16} /> New workout</button>
      </div>

      {list.length === 0 && (
        <div className="card empty">
          <Dumbbell size={28} />
          <p>No workouts yet. Create one (e.g. "Push Day") and list its exercises.</p>
          <button className="btn btn-primary" onClick={() => setNaming({})}><Plus size={16} /> New workout</button>
        </div>
      )}

      {list.length > 0 && (
        <>
          <div className="workout-tabs" role="tablist">
            {list.map((w) => (
              <button key={w.tab} role="tab" aria-selected={w.tab === current.tab}
                className={'acct-chip' + (w.tab === current.tab ? ' on' : '')} onClick={() => select(w.tab)}>
                {w.name} <span className="faint">{w.count}</span>
              </button>
            ))}
          </div>
          {error && <div className="pill neg" style={{ marginBottom: 12 }}>{error}</div>}
          <WorkoutCard key={current.tab} w={current}
            onRename={() => { setError(''); setNaming({ tab: current.tab, name: current.name }); }}
            onDelete={() => removeWorkout(current)} />
        </>
      )}

      {naming && (
        <NameModal initial={naming.name || ''} title={naming.tab ? 'Rename workout' : 'New workout'}
          error={error} onClose={() => setNaming(null)} onSave={saveName} />
      )}
    </>
  );
}

function WorkoutCard({ w, onRename, onDelete }) {
  const rows = workouts.exercises(w.tab);
  const commit = (id, field, value, prev) => {
    const v = field === 'sets' ? Number(value) || 0 : value;
    if (v !== prev) workouts.updateExercise(w.tab, id, { [field]: v });
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{w.name}</h2>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={onRename}><Pencil size={13} /> Rename</button>
          <button className="btn btn-ghost btn-sm danger" onClick={onDelete}><Trash2 size={13} /> Delete</button>
        </div>
      </div>

      <div className="ex-row ex-head" aria-hidden="true">
        <span>Exercise</span><span>Sets</span><span>Reps</span><span>Weight</span><span>Notes</span><span />
      </div>
      {rows.length === 0 && <p className="muted">No exercises yet.</p>}
      {rows.map((r, i) => (
        // Keyed on content so a change from elsewhere refreshes the inputs.
        <div key={r.id + JSON.stringify(r)} className="ex-row">
          <input className="input ex-name" aria-label="Exercise" defaultValue={r.exercise} placeholder="Exercise"
            onBlur={(e) => commit(r.id, 'exercise', e.target.value.trim(), r.exercise)} />
          <label className="ex-field"><span>Sets</span>
            <input className="input num" type="number" inputMode="numeric" min="0" defaultValue={r.sets || ''}
              onBlur={(e) => commit(r.id, 'sets', e.target.value, r.sets)} /></label>
          <label className="ex-field"><span>Reps</span>
            <input className="input num" defaultValue={r.reps} placeholder="8–10"
              onBlur={(e) => commit(r.id, 'reps', e.target.value.trim(), r.reps)} /></label>
          <label className="ex-field"><span>Weight</span>
            <input className="input num" defaultValue={r.weight} placeholder="135 lb"
              onBlur={(e) => commit(r.id, 'weight', e.target.value.trim(), r.weight)} /></label>
          <input className="input ex-notes" aria-label="Notes" defaultValue={r.notes} placeholder="Notes"
            onBlur={(e) => commit(r.id, 'notes', e.target.value, r.notes)} />
          <div className="ex-actions">
            <button className="row-gear always" disabled={i === 0} onClick={() => workouts.moveExercise(w.tab, r.id, -1)} aria-label="Move up"><ChevronUp size={15} /></button>
            <button className="row-gear always" disabled={i === rows.length - 1} onClick={() => workouts.moveExercise(w.tab, r.id, 1)} aria-label="Move down"><ChevronDown size={15} /></button>
            <button className="row-gear always danger" onClick={() => workouts.deleteExercise(w.tab, r.id)} aria-label={`Delete ${r.exercise || 'exercise'}`}><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
        onClick={() => workouts.addExercise(w.tab, { exercise: '', sets: 3, reps: '', weight: '', notes: '' })}>
        <Plus size={14} /> Add exercise
      </button>
    </div>
  );
}

function NameModal({ title, initial, error, onClose, onSave }) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="field">
        <label>Workout name</label>
        <input className="input" autoFocus value={name} placeholder="Push Day" maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name)} />
      </div>
      {error && <div className="pill neg" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave(name)}>Save</button>
      </div>
    </Modal>
  );
}
