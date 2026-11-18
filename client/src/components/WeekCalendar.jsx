import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Circle } from 'lucide-react';
import { onDay } from '../lib/agenda.js';
import { isoDate, shiftDay } from '../lib/format.js';

// Google Calendar-style week grid: an hour scale, events placed by start time
// and sized by duration, overlapping events sharing the column width, a red
// now-line, and an all-day row (all-day events + tasks due that day) on top.
// Events are filled with their account's color; unanswered invitations are
// outlined.

const HOUR = 48; // px per hour; the CSS reads it as --hour
const MIN_HEIGHT = 20; // px, so very short events stay clickable
const SHORT = 40; // below this height, title and time share one line

// "2 – 3:15pm", "11am – 12:30pm"
function clock(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  return { t: `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`, ap: h < 12 ? 'am' : 'pm' };
}
function timeRange(start, end) {
  const a = clock(new Date(start));
  const b = clock(new Date(end));
  return a.ap === b.ap ? `${a.t} – ${b.t}${b.ap}` : `${a.t}${a.ap} – ${b.t}${b.ap}`;
}

const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

// White text unless it would be too faint on this fill (e.g. yellow).
function textOn(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#ffffff';
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) < 3 ? '#222222' : '#ffffff';
}

// Place one day's timed events. Events that overlap (directly or through a
// chain) form a cluster; each gets the first free column in its cluster and
// the cluster's columns split the width evenly.
function layoutDay(events, iso) {
  const dayStart = new Date(iso + 'T00:00:00').getTime();
  const dayEnd = new Date(shiftDay(iso, 1) + 'T00:00:00').getTime();
  const items = events
    .map((e) => {
      const s = Math.max(new Date(e.start).getTime(), dayStart);
      const end = Math.min(new Date(e.end).getTime(), dayEnd);
      return { e, s, end: Math.max(end, s + 15 * 60000) };
    })
    .sort((a, b) => a.s - b.s || (b.end - b.s) - (a.end - a.s));

  const placed = [];
  let cluster = [];
  let colEnds = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    cluster.forEach((it) => { it.cols = colEnds.length; });
    placed.push(...cluster);
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.s);
    if (col === -1) { col = colEnds.length; colEnds.push(it.end); } else colEnds[col] = it.end;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();

  return placed.map((it) => ({
    ...it,
    top: ((it.s - dayStart) / 3600000) * HOUR,
    height: Math.max(((it.end - it.s) / 3600000) * HOUR, MIN_HEIGHT),
  }));
}

export default function WeekCalendar({
  weekStart, day, setDay, loading, events, tasks, byEmail,
  canEditEvent, canEditTask, onEditEvent, onEditTask, onCreateAt,
}) {
  const today = isoDate();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(weekStart, i)), [weekStart]);
  const perDay = useMemo(
    () => days.map((iso) => layoutDay(events.filter((e) => !e.allDay && onDay(e, iso)), iso)),
    [days, events],
  );
  const color = (email) => byEmail[email]?.color || '#9a9a9a';
  const short = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Keep the now-line current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Each time a week is shown, scroll to just before the current time (this
  // week) or to 7am.
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hour = days.includes(today) ? new Date().getHours() - 1.5 : 7;
    el.scrollTop = Math.max(0, hour * HOUR);
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click an empty slot to start a new event there (rounded to 30 minutes).
  const createAt = (iso) => (ev) => {
    if (!onCreateAt || ev.target !== ev.currentTarget) return;
    onCreateAt(iso, Math.floor((ev.nativeEvent.offsetY / HOUR) * 2) * 30);
  };

  return (
    <div className="card week-card">
      <div className="week-head">
        <div className="card-title" style={{ margin: 0 }}>
          Week of {short(days[0])} – {short(days[6])} {loading && <span className="faint">· loading…</span>}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-icon btn-ghost" onClick={() => setDay(shiftDay(day, -7))} aria-label="Previous week"><ChevronLeft size={18} /></button>
          <button className="btn btn-sm" onClick={() => setDay(today)} disabled={days.includes(today)}>This week</button>
          <button className="btn btn-icon btn-ghost" onClick={() => setDay(shiftDay(day, 7))} aria-label="Next week"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="tg" ref={scrollRef} style={{ '--hour': `${HOUR}px` }}>
        <div className="tg-sticky">
          <div className="tg-row">
            <div className="tg-gutter" />
            {days.map((iso) => {
              const d = new Date(iso + 'T00:00:00');
              return (
                <button key={iso} className={'tg-dayhead' + (iso === today ? ' today' : '') + (iso === day ? ' selected' : '')}
                  onClick={() => setDay(iso)} aria-pressed={iso === day}>
                  <span className="tg-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className="tg-date num">{d.getDate()}</span>
                </button>
              );
            })}
          </div>
          <div className="tg-row tg-allday">
            <div className="tg-gutter tg-gutter-label">all-day</div>
            {days.map((iso) => (
              <div key={iso} className="tg-allday-cell">
                {events.filter((e) => e.allDay && onDay(e, iso)).map((e) => {
                  const c = color(e.account);
                  return (
                    <button key={e.account + e.calendarId + e.id} className={'tg-chip' + (e.pending ? ' pending' : '')}
                      style={{ '--c': c, '--on': textOn(c) }} disabled={!canEditEvent(e)} onClick={() => onEditEvent(e)}
                      title={`${e.summary}\n${e.calendarName}`}>
                      {e.summary}
                    </button>
                  );
                })}
                {tasks.filter((t) => t.due === iso).map((t) => (
                  <button key={t.account + t.id} className="tg-task" style={{ '--c': color(t.account) }}
                    disabled={!canEditTask(t)} onClick={() => onEditTask(t)} title={`${t.title}\n${t.listName}`}>
                    <Circle size={11} /> <span>{t.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="tg-row">
          <div className="tg-gutter tg-hours">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="tg-hour" style={{ top: h * HOUR }}>{hourLabel(h)}</span>
            ))}
          </div>
          {days.map((iso, i) => (
            <div key={iso} className={'tg-col' + (iso === day ? ' selected' : '') + (onCreateAt ? ' creatable' : '')}
              onClick={createAt(iso)}>
              {perDay[i].map(({ e, top, height, col, cols }) => {
                const c = color(e.account);
                return (
                  <button key={e.account + e.calendarId + e.id}
                    className={'tg-event' + (e.pending ? ' pending' : '') + (height < SHORT ? ' short' : '')}
                    style={{
                      top, height: height - 2,
                      left: `calc(${(col / cols) * 100}% + 1px)`, width: `calc(${100 / cols}% - 3px)`,
                      '--c': c, '--on': textOn(c),
                    }}
                    disabled={!canEditEvent(e)} onClick={() => onEditEvent(e)}
                    title={`${e.summary}\n${timeRange(e.start, e.end)}${e.location ? `\n${e.location}` : ''}\n${e.calendarName}`}>
                    <span className="tg-title">{e.summary}</span>
                    <span className="tg-time">{height < SHORT ? ', ' : ''}{timeRange(e.start, e.end)}</span>
                    {height >= SHORT * 1.5 && e.location && <span className="tg-loc">{e.location}</span>}
                  </button>
                );
              })}
              {iso === today && <div className="tg-now" style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
