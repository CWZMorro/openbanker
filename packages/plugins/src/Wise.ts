import type { Transaction, TransactionGroup } from "@openbanker/core/types";

export default function scrape(): TransactionGroup[] {
  function parseDate(raw: string): string {
    const str = raw.trim();
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };

    // "16 May 2026" or "11 March 2025" — full date with year
    const fullMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (fullMatch) {
      const day = fullMatch[1].padStart(2, '0');
      const monthIdx = months[fullMatch[2].toLowerCase().slice(0, 3)];
      const year = fullMatch[3];
      if (monthIdx) return `${year}-${String(monthIdx).padStart(2, '0')}-${day}`;
    }

    const now = new Date();
    const lower = str.toLowerCase();
    if (lower === 'today') return now.toISOString().slice(0, 10);
    if (lower === 'yesterday') {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    }

    // "Card checked · Tue, 12 May" — strip status prefix and recurse
    if (str.includes(' · ')) {
      return parseDate(str.split(' · ').pop()!);
    }

    // "Tue, 12 May" — strip day-of-week prefix and recurse
    const dayPrefixMatch = str.match(/^[A-Za-z]{2,3},?\s+(.+)$/);
    if (dayPrefixMatch && /\d/.test(dayPrefixMatch[1])) {
      return parseDate(dayPrefixMatch[1]);
    }

    // "Friday", "Monday", etc. — most recent occurrence of that weekday
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIdx = dayNames.indexOf(lower);
    if (dayIdx !== -1) {
      let daysBack = (now.getDay() - dayIdx + 7) % 7;
      if (daysBack === 0) daysBack = 7; // "today" shows as "Today", so this must be last week
      const d = new Date(now);
      d.setDate(now.getDate() - daysBack);
      return d.toISOString().slice(0, 10);
    }

    // "5 Jun" or "5 June" without year (/home page)
    const shortMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)$/);
    if (shortMatch) {
      const day = parseInt(shortMatch[1]);
      const monthIdx = months[shortMatch[2].toLowerCase().slice(0, 3)];
      if (monthIdx) {
        const year = now.getFullYear();
        const candidate = new Date(year, monthIdx - 1, day);
        if (candidate > now) candidate.setFullYear(year - 1);
        return `${candidate.getFullYear()}-${String(monthIdx).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    console.warn("Wise: could not parse date:", str);
    return "";
  }

  function parseAmount(amountEl: HTMLElement): { amount: number; currency: string; isDeposit: boolean } | null {
    const positiveSpan = amountEl.querySelector<HTMLElement>('[class*="positive"]');
    const rawText = (positiveSpan ?? amountEl).textContent?.trim() ?? '';
    const isDeposit = !!positiveSpan || rawText.startsWith('+');
    const cleaned = rawText.replace(/^[+\-]\s*/, '').trim();
    const match = cleaned.match(/^([\d,]+\.?\d*)\s+([A-Z]{3})$/);
    if (!match) {
      console.warn("Wise: could not parse amount:", rawText);
      return null;
    }
    return {
      amount: parseFloat(match[1].replace(/,/g, '')),
      currency: match[2],
      isDeposit,
    };
  }

  const groups: Record<string, Transaction[]> = {};

  function addToGroup(currency: string, tx: Transaction) {
    if (!groups[currency]) groups[currency] = [];
    groups[currency].push(tx);
  }

  // --- /all-transactions page ---
  const allTxLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[data-testid="activity-summary"]')
  );

  if (allTxLinks.length) {
    for (const link of allTxLinks) {
      const statusEl = link.querySelector<HTMLElement>('[id$="-status"]');
      if (statusEl?.textContent?.trim().toLowerCase() === 'cancelled') continue;

      const titleEl = link.querySelector<HTMLElement>('[id$="-title"]');
      const amountEl = link.querySelector<HTMLElement>('[id$="-amount"]');
      const dateEl = link.querySelector<HTMLElement>('[id$="-date"]');

      if (!titleEl || !amountEl) continue;

      const parsed = parseAmount(amountEl);
      if (!parsed) continue;

      const hrefMatch = link.href.match(/by-resource\/([^/]+)\/(\d+)/);
      const external_id = hrefMatch ? `${hrefMatch[1]}-${hrefMatch[2]}` : '';
      const title = titleEl.textContent?.trim() ?? '';
      const isConversionIn = /^To\s+[A-Z]{3}$/.test(title);
      const date = parseDate(dateEl?.textContent?.trim() ?? '');
      const amountInfoEl = link.querySelector<HTMLElement>('[class*="amountInfo"]');

      if (isConversionIn) {
        addToGroup(parsed.currency, { date, description: title, amount: parsed.amount, type: 'deposit', category_name: '', external_id, notes: parsed.currency });
        if (amountInfoEl) {
          const sourceMatch = amountInfoEl.textContent?.trim().match(/^([\d,]+\.?\d*)\s+([A-Z]{3})$/);
          if (sourceMatch) {
            addToGroup(sourceMatch[2], { date, description: title, amount: parseFloat(sourceMatch[1].replace(/,/g, '')), type: 'withdrawal', category_name: '', external_id: external_id ? `${external_id}-debit` : '', notes: sourceMatch[2] });
          }
        }
      } else if (!parsed.isDeposit && amountInfoEl) {
        const sourceMatch = amountInfoEl.textContent?.trim().match(/^([\d,]+\.?\d*)\s+([A-Z]{3})$/);
        if (sourceMatch) {
          addToGroup(sourceMatch[2], { date, description: title, amount: parseFloat(sourceMatch[1].replace(/,/g, '')), type: 'withdrawal', category_name: '', external_id, notes: `${parsed.amount} ${parsed.currency}` });
        } else {
          addToGroup(parsed.currency, { date, description: title, amount: parsed.amount, type: 'withdrawal', category_name: '', external_id, notes: parsed.currency });
        }
      } else {
        addToGroup(parsed.currency, { date, description: title, amount: parsed.amount, type: parsed.isDeposit ? 'deposit' : 'withdrawal', category_name: '', external_id, notes: parsed.currency });
      }
    }
  } else {
    // --- /home page fallback ---
    const homeLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="urn%3Awise%3Aactivities%3A"]')
    );

    for (const link of homeLinks) {
      const titleEl = link.querySelector<HTMLElement>('[class*="activitySummaryTitle"]');
      const dateEl = link.querySelector<HTMLElement>('[class*="activitySummaryDescription"]');
      const amountEl = link.querySelector<HTMLElement>('[class*="summaryAmount"]');

      if (!titleEl || !amountEl) continue;

      const parsed = parseAmount(amountEl);
      if (!parsed) continue;

      let external_id = '';
      const urnMatch = link.href.match(/urn%3Awise%3Aactivities%3A([^&]+)/);
      if (urnMatch) {
        try {
          const decoded = atob(decodeURIComponent(urnMatch[1]));
          const parts = decoded.split('::');
          if (parts.length >= 4) external_id = `${parts[2]}-${parts[3]}`;
        } catch (_) { }
      }

      addToGroup(parsed.currency, {
        date: parseDate(dateEl?.textContent?.trim() ?? ''),
        description: titleEl.textContent?.trim() ?? '',
        amount: parsed.amount,
        type: parsed.isDeposit ? 'deposit' : 'withdrawal',
        category_name: '',
        external_id,
        notes: parsed.currency,
      });
    }
  }

  return Object.entries(groups).map(([currency, transactions]) => ({
    account: `Wise ${currency}`,
    transactions,
  }));
}
