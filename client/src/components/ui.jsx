import {
  ChevronLeft, ChevronRight, X, AlertTriangle, RefreshCw, Circle,
  Home, Zap, Shield, Wifi, ShoppingCart, Car, HeartPulse, Sparkles, Utensils, Coffee,
  Repeat, ShoppingBag, Clapperboard, TrendingUp, PiggyBank, LineChart, Umbrella,
} from 'lucide-react';
import { useApp, MONTH_NAMES } from '../state.jsx';

// Icons a category can name in its `icon` column. Imported individually so
// the bundle doesn't carry all of Lucide; unknown names fall back to Circle.
const CATEGORY_ICONS = {
  Circle, Home, Zap, Shield, Wifi, ShoppingCart, Car, HeartPulse, Sparkles, Utensils, Coffee,
  Repeat, ShoppingBag, Clapperboard, TrendingUp, PiggyBank, LineChart, Umbrella,
};

// Resolve a Lucide icon by name (categories store an icon string).
export function CatIcon({ name, size = 16 }) {
  const Icon = CATEGORY_ICONS[name] || Circle;
  return <Icon size={size} strokeWidth={2} />;
}

export function ProgressBar({ value, over, warn }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  const cls = 'progress' + (over ? ' over' : warn ? ' warn' : '');
  return (
    <div className={cls} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

export function MonthPicker() {
  const { year, month, shiftMonth } = useApp();
  return (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn btn-icon btn-ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">
        <ChevronLeft size={18} />
      </button>
      <strong style={{ minWidth: 130, textAlign: 'center' }}>
        {MONTH_NAMES[month - 1]} {year}
      </strong>
      <button className="btn btn-icon btn-ghost" onClick={() => shiftMonth(1)} aria-label="Next month">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' modal-lg' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Colored dot identifying which Google account an item belongs to.
export function AccountDot({ color, title, size = 9 }) {
  return (
    <span className="acct-dot" title={title} aria-label={title}
      style={{ background: color || 'var(--text-faint)', width: size, height: size }} />
  );
}

// Inline per-account failure with a Reconnect button (the click lets the
// browser open Google's popup).
export function AccountError({ account, error, onReconnect, connecting }) {
  return (
    <div className="acct-error" role="alert">
      <AlertTriangle size={15} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{account.name || account.email}</strong>
        <div className="faint acct-error-msg">{error?.message || 'Not connected yet.'}</div>
      </div>
      <button data-auth-action className="btn btn-sm" disabled={connecting} onClick={onReconnect}>
        <RefreshCw size={13} /> {connecting ? 'Connecting…' : 'Reconnect'}
      </button>
    </div>
  );
}
