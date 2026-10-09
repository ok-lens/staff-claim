(function (root) {
  function validDate(year, month, day) {
    year = Number(year); month = Number(month); day = Number(day);
    if (year < 2000 || year > 2099) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function parseReceipt(text) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let date = null;
    const candidates = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!date && !/expiry|due date|valid until/i.test(line)) {
        const iso = line.match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
        const local = line.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2}|\d{2})\b/);
        const named = line.match(/\b(\d{1,2})[\s/-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s/-]+(20\d{2}|\d{2})\b/i);
        if (iso) date = validDate(iso[1], iso[2], iso[3]);
        else if (local) date = validDate(local[3].length === 2 ? '20' + local[3] : local[3], local[2], local[1]);
        else if (named) date = validDate(named[3].length === 2 ? '20' + named[3] : named[3], ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].toLowerCase()) + 1, named[1]);
      }
      if (/sub\s*total|rounding adjustment|cash tender|change|total (items|qty|quantity)/i.test(line)) continue;
      const label = line.match(/total\s*payable|rounded\s*total|grand\s*total|total\s*outstanding\s*amount|total\s*amount|total\s*products|net\s*total|amount\s*due|total\b/i);
      if (!label) continue;
      const tail = line.slice(label.index + label[0].length);
      const amounts = tail.match(/\b\d[\d,]*\.\d{2}\b/g) || (tail.trim() ? [] : (lines[index + 1] || '').match(/^\s*(?:RM\s*)?(\d[\d,]*\.\d{2})\s*$/i)?.slice(1)) || [];
      const value = Number(amounts.at(-1)?.replaceAll(',', ''));
      if (!Number.isFinite(value) || value <= 0) continue;
      const priority = /payable|rounded|grand/i.test(label[0]) ? 100 : /outstanding|due/i.test(label[0]) ? 80 : 60;
      candidates.push({ value, priority });
    }
    candidates.sort((a, b) => b.priority - a.priority);
    const top = candidates.filter(item => item.priority === candidates[0]?.priority);
    const total = new Set(top.map(item => item.value)).size === 1 ? top[0]?.value : null;
    return { date, total: total ?? null };
  }
  root.ReceiptOCR = { parseReceipt };
  if (typeof module !== 'undefined') module.exports = { parseReceipt };
})(typeof window === 'undefined' ? globalThis : window);
