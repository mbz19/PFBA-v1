// Shared formatters (moved from the old lib/api.js).
export const fmt = {
  money(n, { sign = false } = {}) {
    const v = Number(n) || 0;
    const s = v.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (sign && v > 0) return '+' + s;
    return s;
  },
  money0(n) {
    return (Number(n) || 0).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  },
  pct(n) {
    return `${Math.round((Number(n) || 0) * 100)}%`;
  },
  dateLong(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  },
  time(d) {
    return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  },
};

// Local-time yyyy-mm-dd (toISOString would shift to UTC).
export function isoDate(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
