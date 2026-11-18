import { useEffect, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Circle, CheckCircle2, MapPin, Repeat, X } from 'lucide-react';
import { useApp } from '../state.jsx';
import * as agenda from '../lib/agenda.js';
import { fmt, isoDate, shiftDay } from '../lib/format.js';
import { Modal, AccountDot, AccountError } from '../components/ui.jsx';
import WeekCalendar from '../components/WeekCalendar.jsx';

const HIDDEN_KEY = 'pfba.home.hiddenAccounts';
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY)) || []); } catch { return new Set(); } };
const saveHidden = (s) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])); } catch { /* ignore */ } };

// Weeks run Sunday–Saturday, like Google Calendar's US default.
function weekStartOf(iso) {
  return shiftDay(iso, -new Date(iso + 'T00:00:00').getDay());
}

function dayLabel(iso) {
  const today = isoDate();
  if (iso === today) return 'Today';
  if (iso === shiftDay(today, 1)) return 'Tomorrow';
  if (iso === shiftDay(today, -1)) return 'Yesterday';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
}

const hhmm = (dt) => { const d = new Date(dt); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function Home() {
  const { accounts, status, reconnect } = useApp();
  const [day, setDay] = useState(isoDate());
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(loadHidden);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [actionError, setActionError] = useState('');

  const byEmail = useMemo(() => Object.fromEntries(accounts.map((a) => [a.email, a])), [accounts]);
  const okAccounts = accounts.filter((a) => status[a.email]?.state === 'ok');
  const okKey = okAccounts.map((a) => a.email).join('|');
  const weekStart = weekStartOf(day);

  // Load the whole week containing `day`; moving between days of the same
  // week doesn't refetch.
  const load = useCallback(async () => {
    if (!okAccounts.length) { setData({}); return; }
    setLoading(true);
    try {
      setData(await agenda.loadRange(okAccounts, weekStart, 7));
    } finally {
      setLoading(false);
    }
  }, [weekStart, okKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  function toggleAccount(email) {
    const next = new Set(hidden);
    next.has(email) ? next.delete(email) : next.add(email);
    setHidden(next);
    saveHidden(next);
  }

  async function act(fn) {
    setActionError('');
    try { await fn(); } catch (err) { setActionError(err.message || 'Something went wrong'); }
    await load();
  }

  async function onReconnect(email) {
    if (await reconnect(email)) load();
  }

  const visible = (email) => !hidden.has(email);
  const editable = (email) => byEmail[email]?.editable !== false && status[email]?.state === 'ok';

  // Merge the week's events from all visible accounts: all-day first, then by
  // start time. The day card shows the selected day's slice.
  const weekEvents = Object.values(data)
    .flatMap((d) => d.events)
    .filter((e) => visible(e.account))
    .sort((a, b) => (b.allDay - a.allDay) || String(a.start).localeCompare(String(b.start)));
  const events = weekEvents.filter((e) => agenda.onDay(e, day));
  const weekTasks = Object.values(data)
    .flatMap((d) => (d.ok ? d.tasks : []))
    .filter((t) => visible(t.account) && t.due);

  // Accounts whose fetch failed, or that aren't connected yet, get an inline
  // error with Reconnect.
  const failures = accounts.filter((a) => {
    const st = status[a.email]?.state;
    return st === 'error' || st === 'idle' || (st === 'ok' && data[a.email] && !data[a.email].ok);
  });

  // For the create dialogs: accounts that can be written to, primary first.
  const writableAccounts = okAccounts.filter((a) => a.editable !== false)
    .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));

  // New event from an empty calendar slot: one hour starting there.
  const newEventAt = (iso, minutes) => {
    const local = (d) => `${isoDate(d)}T${hhmm(d)}`;
    const start = new Date(iso + 'T00:00:00');
    start.setMinutes(minutes);
    setEditingEvent({ start: local(start), end: local(new Date(start.getTime() + 3600000)) });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{dayLabel(day)}</h1>
          <p className="page-sub">{fmt.dateLong(day)}</p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-icon btn-ghost" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
            <button className="btn btn-sm" onClick={() => setDay(isoDate())} disabled={day === isoDate()}>Today</button>
            <button className="btn btn-icon btn-ghost" onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
          </div>
          <button className="btn btn-primary btn-sm" disabled={!writableAccounts.length} onClick={() => setEditingEvent({})}><Plus size={15} /> Event</button>
          <button className="btn btn-primary btn-sm" disabled={!writableAccounts.length} onClick={() => setEditingTask({})}><Plus size={15} /> Task</button>
        </div>
      </div>

      {/* Per-account filter toggles */}
      <div className="acct-filters" role="group" aria-label="Show accounts">
        {accounts.map((a) => (
          <button key={a.email} className={'acct-chip' + (visible(a.email) ? ' on' : '')}
            aria-pressed={visible(a.email)} onClick={() => toggleAccount(a.email)} title={a.email}>
            <AccountDot color={a.color} title={a.email} />
            {a.name || a.email}
            {status[a.email]?.state === 'connecting' && <span className="faint"> · connecting…</span>}
          </button>
        ))}
      </div>

      {failures.map((a) => (
        <AccountError key={a.email} account={a}
          error={status[a.email]?.error || data[a.email]?.error}
          connecting={status[a.email]?.state === 'connecting'}
          onReconnect={() => onReconnect(a.email)} />
      ))}

      {actionError && (
        <div className="acct-error" role="alert">
          <span style={{ flex: 1 }}>{actionError}</span>
          <button className="btn btn-icon btn-ghost" onClick={() => setActionError('')} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-2 home-grid">
        {/* Events */}
        <div className="card">
          <div className="card-title">Events {loading && <span className="faint">· loading…</span>}</div>
          {!loading && events.length === 0 && <p className="muted">Nothing on the calendar.</p>}
          {events.map((e) => {
            const acct = byEmail[e.account];
            const canEdit = e.writable && editable(e.account);
            return (
              <div key={e.account + e.calendarId + e.id} className={'agenda-row' + (canEdit ? ' clickable' : '')}
                onClick={() => canEdit && setEditingEvent(e)}>
                <AccountDot color={acct?.color} title={e.account} />
                <div className="agenda-time num">
                  {e.allDay ? 'All day' : <>{fmt.time(e.start)}<span className="faint"> – {fmt.time(e.end)}</span></>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="agenda-title">{e.summary} {e.recurring && <Repeat size={11} className="faint" />}</div>
                  <div className="agenda-meta">
                    {e.calendarName}{acct ? ` · ${acct.name || acct.email}` : ''}
                    {e.location && <> · <MapPin size={11} /> {e.location}</>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tasks, grouped by account then task list */}
        <div className="card">
          <div className="card-title">Open tasks</div>
          {okAccounts.filter((a) => visible(a.email)).map((a) => {
            const d = data[a.email];
            if (!d?.ok) return null;
            return (
              <div key={a.email} className="task-account">
                <div className="task-account-head"><AccountDot color={a.color} title={a.email} /> {a.name || a.email}</div>
                {d.taskLists.map((list) => {
                  const tasks = d.tasks.filter((t) => t.listId === list.id)
                    .sort((x, y) => (!x.due) - (!y.due) || x.due.localeCompare(y.due));
                  if (!tasks.length) return null;
                  return (
                    <div key={list.id} className="task-list">
                      <div className="task-list-name">{list.name}</div>
                      {tasks.map((t) => (
                        <TaskRow key={t.id} t={t} day={day} canEdit={editable(a.email)}
                          onToggle={() => act(() => agenda.setTaskCompleted(a.email, t.listId, t.id, !t.completed))}
                          onEdit={() => setEditingTask(t)}
                          onDelete={() => act(() => agenda.deleteTask(a.email, t.listId, t.id))} />
                      ))}
                    </div>
                  );
                })}
                {!d.tasks.length && <p className="faint" style={{ margin: '4px 0 0', fontSize: 13 }}>No open tasks.</p>}
              </div>
            );
          })}
        </div>
      </div>

      <WeekCalendar weekStart={weekStart} day={day} setDay={setDay} loading={loading}
        events={weekEvents} tasks={weekTasks} byEmail={byEmail}
        canEditEvent={(e) => e.writable && editable(e.account)}
        canEditTask={(t) => editable(t.account)}
        onEditEvent={setEditingEvent} onEditTask={setEditingTask}
        onCreateAt={writableAccounts.length ? newEventAt : null} />

      {editingEvent && (
        <EventModal event={editingEvent} day={day} accounts={writableAccounts} data={data}
          onClose={() => setEditingEvent(null)}
          onSave={(acct, calId, form) => { setEditingEvent(null); act(() => editingEvent.id
            ? agenda.updateEvent(acct, calId, editingEvent.id, form)
            : agenda.createEvent(acct, calId, form)); }}
          onDelete={editingEvent.id ? () => { const e = editingEvent; setEditingEvent(null); act(() => agenda.deleteEvent(e.account, e.calendarId, e.id)); } : null} />
      )}

      {editingTask && (
        <TaskModal task={editingTask} day={day} accounts={writableAccounts} data={data}
          onClose={() => setEditingTask(null)}
          onSave={(acct, listId, form) => { setEditingTask(null); act(() => editingTask.id
            ? agenda.updateTask(acct, listId, editingTask.id, form)
            : agenda.createTask(acct, listId, form)); }}
          onDelete={editingTask.id ? () => { const t = editingTask; setEditingTask(null); act(() => agenda.deleteTask(t.account, t.listId, t.id)); } : null} />
      )}
    </>
  );
}

function TaskRow({ t, day, canEdit, onToggle, onEdit, onDelete }) {
  const overdue = t.due && t.due < day;
  const dueToday = t.due === day;
  return (
    <div className="agenda-row task-row">
      <button className="task-check" disabled={!canEdit} onClick={onToggle} aria-label={t.completed ? 'Mark not done' : 'Mark done'}>
        {t.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }} className={canEdit ? 'clickable' : ''} onClick={() => canEdit && onEdit()}>
        <div className="agenda-title">{t.title}</div>
        {(t.due || t.notes) && (
          <div className="agenda-meta">
            {t.due && <span className={overdue ? 'over-amt' : dueToday ? 'due-today' : ''}>
              {overdue ? 'Overdue · ' : dueToday ? 'Due today · ' : 'Due '}{fmt.dateLong(t.due)}
            </span>}
            {t.notes && <span className="task-notes">{t.due ? ' · ' : ''}{t.notes}</span>}
          </div>
        )}
      </div>
      {canEdit && (
        <button className="row-gear always" onClick={onDelete} aria-label={`Delete ${t.title}`}><Trash2 size={14} /></button>
      )}
    </div>
  );
}

// Account → calendar picker (grouped by account) for a new event; fixed to the
// owning account/calendar when editing.
function EventModal({ event, day, accounts, data, onClose, onSave, onDelete }) {
  const isEdit = !!event.id;
  const [acct, setAcct] = useState(event.account || accounts[0]?.email || '');
  const cals = (data[acct]?.calendars || []).filter((c) => c.writable);
  const [calId, setCalId] = useState(event.calendarId || '');
  const effectiveCal = calId && (isEdit || cals.some((c) => c.id === calId)) ? calId : (cals.find((c) => c.primary) || cals[0])?.id || '';

  const startDate = event.start ? String(event.start).slice(0, 10) : day;
  const endDate = event.allDay && event.end
    ? isoDate(new Date(new Date(event.end + 'T00:00:00').getTime() - 86400000))
    : event.end ? isoDate(new Date(event.end)) : startDate;
  const [f, setF] = useState({
    summary: event.summary === '(no title)' ? '' : event.summary || '',
    location: event.location || '',
    description: event.description || '',
    allDay: !!event.allDay,
    date: startDate,
    endDate,
    startTime: event.start && !event.allDay ? hhmm(event.start) : '09:00',
    endTime: event.end && !event.allDay ? hhmm(event.end) : '10:00',
  });
  const endsBeforeStart = f.endDate < f.date || (!f.allDay && f.endDate === f.date && f.endTime <= f.startTime);

  return (
    <Modal title={isEdit ? 'Edit event' : 'New event'} onClose={onClose}>
      <div className="field">
        <label>Title</label>
        <input className="input" autoFocus value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Account</label>
          <select className="select" value={acct} disabled={isEdit} onChange={(e) => { setAcct(e.target.value); setCalId(''); }}>
            {isEdit && !accounts.some((a) => a.email === acct) && <option value={acct}>{acct}</option>}
            {accounts.map((a) => <option key={a.email} value={a.email}>{a.name || a.email}{a.primary ? ' (primary)' : ''}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Calendar</label>
          <select className="select" value={effectiveCal} disabled={isEdit} onChange={(e) => setCalId(e.target.value)}>
            {isEdit && <option value={event.calendarId}>{event.calendarName}</option>}
            {!isEdit && cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <label className="row" style={{ gap: 6, marginBottom: 12 }}>
        <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> All day
      </label>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Starts</label>
          <input className="input" type="date" value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} />
          {!f.allDay && <input className="input" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />}
        </div>
        <div className="field">
          <label>Ends</label>
          <input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          {!f.allDay && <input className="input" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />}
        </div>
      </div>
      <div className="field">
        <label>Location</label>
        <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      {endsBeforeStart && <div className="pill neg" style={{ marginBottom: 12 }}>End must be after start.</div>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {onDelete ? <button className="btn btn-ghost danger" onClick={onDelete}>Delete</button> : <span />}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.summary.trim() || !effectiveCal || endsBeforeStart}
            onClick={() => onSave(acct, effectiveCal, f)}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TaskModal({ task, day, accounts, data, onClose, onSave, onDelete }) {
  const isEdit = !!task.id;
  const [acct, setAcct] = useState(task.account || accounts[0]?.email || '');
  const lists = data[acct]?.taskLists || [];
  const [listId, setListId] = useState(task.listId || '');
  const effectiveList = listId && (isEdit || lists.some((l) => l.id === listId)) ? listId : lists[0]?.id || '';
  const [f, setF] = useState({ title: task.title || '', notes: task.notes || '', due: isEdit ? task.due : day });

  return (
    <Modal title={isEdit ? 'Edit task' : 'New task'} onClose={onClose}>
      <div className="field">
        <label>Title</label>
        <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Account</label>
          <select className="select" value={acct} disabled={isEdit} onChange={(e) => { setAcct(e.target.value); setListId(''); }}>
            {isEdit && !accounts.some((a) => a.email === acct) && <option value={acct}>{acct}</option>}
            {accounts.map((a) => <option key={a.email} value={a.email}>{a.name || a.email}{a.primary ? ' (primary)' : ''}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Task list</label>
          <select className="select" value={effectiveList} disabled={isEdit} onChange={(e) => setListId(e.target.value)}>
            {isEdit && <option value={task.listId}>{task.listName}</option>}
            {!isEdit && lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Due date <span className="faint">(optional)</span></label>
        <input className="input" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {onDelete ? <button className="btn btn-ghost danger" onClick={onDelete}>Delete</button> : <span />}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.title.trim() || !effectiveList}
            onClick={() => onSave(acct, effectiveList, f)}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
