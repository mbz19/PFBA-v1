// Google Calendar + Google Tasks across every connected account. Each request
// runs as the account that owns the data, and one account failing never hides
// the others: loadDay() returns a per-account result with its own error.
import { authedFetch } from './auth.js';
import { isoDate } from './format.js';

const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';

const calListCache = new Map(); // email -> calendars[]
const taskListCache = new Map(); // email -> taskLists[]

async function listAll(email, url, query = {}) {
  const out = [];
  let pageToken;
  do {
    const res = await authedFetch(email, url, { query: { ...query, pageToken } });
    out.push(...(res?.items || []));
    pageToken = res?.nextPageToken;
  } while (pageToken);
  return out;
}

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------------------------------------------------------------------------
// Calendars & task lists (cached; they rarely change)
// ---------------------------------------------------------------------------
export async function calendars(email, { fresh = false } = {}) {
  if (!fresh && calListCache.has(email)) return calListCache.get(email);
  const items = await listAll(email, `${CAL}/users/me/calendarList`, { minAccessRole: 'reader' });
  const cals = items
    .map((c) => ({
      id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor,
      primary: !!c.primary, selected: !!c.selected || !!c.primary,
      writable: c.accessRole === 'owner' || c.accessRole === 'writer',
    }))
    .sort((a, b) => b.primary - a.primary || a.name.localeCompare(b.name));
  calListCache.set(email, cals);
  return cals;
}

export async function taskLists(email, { fresh = false } = {}) {
  if (!fresh && taskListCache.has(email)) return taskListCache.get(email);
  const items = await listAll(email, `${TASKS}/users/@me/lists`, { maxResults: 100 });
  const lists = items.map((l) => ({ id: l.id, name: l.title }));
  taskListCache.set(email, lists);
  return lists;
}

export function forgetAccount(email) {
  calListCache.delete(email);
  taskListCache.delete(email);
}

// ---------------------------------------------------------------------------
// One day for every account
// ---------------------------------------------------------------------------
function normalizeEvent(e, email, cal) {
  const allDay = !!e.start?.date;
  return {
    id: e.id,
    account: email,
    calendarId: cal.id,
    calendarName: cal.name,
    writable: cal.writable && !e.locked,
    summary: e.summary || '(no title)',
    location: e.location || '',
    description: e.description || '',
    allDay,
    start: allDay ? e.start.date : e.start.dateTime,
    end: allDay ? e.end.date : e.end.dateTime,
    htmlLink: e.htmlLink,
    recurring: !!e.recurringEventId,
  };
}

function normalizeTask(t, email, list) {
  return {
    id: t.id,
    account: email,
    listId: list.id,
    listName: list.name,
    title: t.title || '(untitled)',
    notes: t.notes || '',
    due: t.due ? t.due.slice(0, 10) : '',
    completed: t.status === 'completed',
  };
}

async function accountDay(email, dayIso) {
  const start = new Date(dayIso + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [cals, lists] = await Promise.all([calendars(email), taskLists(email)]);
  const shown = cals.filter((c) => c.selected);
  const [eventGroups, taskGroups] = await Promise.all([
    Promise.all(shown.map(async (cal) => {
      const items = await listAll(email, `${CAL}/calendars/${encodeURIComponent(cal.id)}/events`, {
        timeMin: start.toISOString(), timeMax: end.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: 250,
      });
      return items
        .filter((e) => e.status !== 'cancelled')
        .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === 'declined'))
        .map((e) => normalizeEvent(e, email, cal));
    })),
    Promise.all(lists.map(async (list) => {
      const items = await listAll(email, `${TASKS}/lists/${encodeURIComponent(list.id)}/tasks`, {
        showCompleted: 'false', showHidden: 'false', maxResults: 100,
      });
      return items.filter((t) => t.title || t.notes).map((t) => normalizeTask(t, email, list));
    })),
  ]);
  return { calendars: cals, taskLists: lists, events: eventGroups.flat(), tasks: taskGroups.flat() };
}

// accounts: [{ email }]. Returns { [email]: { ok, error, calendars, taskLists, events, tasks } }
export async function loadDay(accounts, dayIso) {
  const results = await Promise.allSettled(accounts.map((a) => accountDay(a.email, dayIso)));
  const out = {};
  accounts.forEach((a, i) => {
    const r = results[i];
    out[a.email] = r.status === 'fulfilled'
      ? { ok: true, error: null, ...r.value }
      : { ok: false, error: r.reason, calendars: [], taskLists: [], events: [], tasks: [] };
  });
  return out;
}

// ---------------------------------------------------------------------------
// Event writes — always as the owning account
// ---------------------------------------------------------------------------
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

// form: { summary, location, description, allDay, date, startTime, endTime, endDate? }
export function eventBody(form) {
  const tz = timeZone();
  const body = { summary: form.summary, location: form.location || '', description: form.description || '' };
  if (form.allDay) {
    body.start = { date: form.date };
    body.end = { date: addDays(form.endDate || form.date, 1) };
  } else {
    body.start = { dateTime: `${form.date}T${form.startTime}:00`, timeZone: tz };
    body.end = { dateTime: `${form.endDate || form.date}T${form.endTime}:00`, timeZone: tz };
  }
  return body;
}

const eventsUrl = (calendarId) => `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`;

export const createEvent = (email, calendarId, form) =>
  authedFetch(email, eventsUrl(calendarId), { method: 'POST', body: eventBody(form) });

export const updateEvent = (email, calendarId, eventId, form) =>
  authedFetch(email, `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: eventBody(form) });

export const deleteEvent = (email, calendarId, eventId) =>
  authedFetch(email, `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Task writes
// ---------------------------------------------------------------------------
const tasksUrl = (listId) => `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`;
const dueValue = (iso) => (iso ? `${iso}T00:00:00.000Z` : null);

export const createTask = (email, listId, { title, notes, due }) =>
  authedFetch(email, tasksUrl(listId), { method: 'POST', body: { title, notes: notes || '', due: dueValue(due) || undefined } });

export const updateTask = (email, listId, taskId, { title, notes, due }) =>
  authedFetch(email, `${tasksUrl(listId)}/${encodeURIComponent(taskId)}`, {
    method: 'PATCH', body: { title, notes: notes || '', due: dueValue(due) },
  });

export const setTaskCompleted = (email, listId, taskId, completed) =>
  authedFetch(email, `${tasksUrl(listId)}/${encodeURIComponent(taskId)}`, {
    method: 'PATCH', body: completed ? { status: 'completed' } : { status: 'needsAction', completed: null },
  });

export const deleteTask = (email, listId, taskId) =>
  authedFetch(email, `${tasksUrl(listId)}/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
