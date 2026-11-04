// Detect recurring bills/subscriptions from transaction history. Pure — takes
// an array of transactions (with a normalized merchant key + a primary
// category) and returns candidate recurring items. No DB access.

function normalizeKey(merchant) {
  return (merchant || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Classify an average gap (days) into a frequency bucket.
function classifyCadence(avgGap) {
  if (avgGap >= 5 && avgGap <= 9) return 'weekly';
  if (avgGap >= 11 && avgGap <= 18) return 'biweekly';
  if (avgGap >= 25 && avgGap <= 38) return 'monthly';
  if (avgGap >= 80 && avgGap <= 100) return 'quarterly';
  if (avgGap >= 330 && avgGap <= 400) return 'yearly';
  return null;
}

const FREQ_DAYS = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };

/**
 * @param {{date, amount, merchant, category_id}[]} txns  expense txns (amount<0)
 * @returns candidate recurring items sorted by confidence
 */
export function detectRecurring(txns) {
  const groups = new Map();
  for (const t of txns) {
    if (t.is_income) continue;
    const key = normalizeKey(t.merchant);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const suggestions = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    // Gaps between consecutive occurrences (days)
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const g = (new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / 86400000;
      gaps.push(g);
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const frequency = classifyCadence(avgGap);
    if (!frequency) continue;

    // Amount stability — recurring bills tend to be consistent.
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const medAmt = median(amounts);
    const maxDev = Math.max(...amounts.map((a) => Math.abs(a - medAmt)));
    const stable = medAmt > 0 && maxDev / medAmt <= 0.2; // within 20%
    if (!stable) continue;

    // Most common category among occurrences
    const catCounts = {};
    for (const t of sorted) if (t.category_id) catCounts[t.category_id] = (catCounts[t.category_id] || 0) + 1;
    const categoryId = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a])[0];

    const lastDate = sorted[sorted.length - 1].date;
    const next = new Date(lastDate);
    next.setDate(next.getDate() + FREQ_DAYS[frequency]);

    suggestions.push({
      merchant_key: key,
      name: sorted[sorted.length - 1].merchant,
      amount: Math.round(medAmt * 100) / 100,
      frequency,
      category_id: categoryId ? Number(categoryId) : null,
      occurrences: sorted.length,
      last_date: lastDate,
      next_due: next.toISOString().slice(0, 10),
      confidence: sorted.length >= 3 ? 'high' : 'medium',
    });
  }

  // Most occurrences first
  return suggestions.sort((a, b) => b.occurrences - a.occurrences);
}

// Convert a frequency to an equivalent monthly dollar amount (for safe-to-spend).
export function monthlyEquivalent(amount, frequency) {
  const perYear = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };
  return (Number(amount) || 0) * (perYear[frequency] || 12) / 12;
}
