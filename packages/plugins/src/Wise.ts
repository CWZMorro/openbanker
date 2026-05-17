import type { Transaction, TransactionGroup } from "@openbanker/core/types";

export default function scrape(): TransactionGroup[] {
  function parseDate(raw: string): string {
    const str = raw.trim();
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };

    // "16 May 2026" or "11 March 2025" — year always present on /all-transactions
    const fullMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (fullMatch) {
      const day = fullMatch[1].padStart(2, '0');
      const monthIdx = months[fullMatch[2].toLowerCase().slice(0, 3)];
      const year = fullMatch[3];
      if (monthIdx) return `${year}-${String(monthIdx).padStart(2, '0')}-${day}`;
    }

    // Relative dates from /home page
    const now = new Date();
    const lower = str.toLowerCase();
    if (lower === 'today') return now.toISOString().slice(0, 10);
    if (lower === 'yesterday') {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
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
    const cleaned = rawText.replace(/^\+\s*/, '').trim();
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

  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[data-testid="activity-summary"]')
  );

  if (!links.length) return [];

  const groups: Record<string, Transaction[]> = {};

  function addToGroup(currency: string, tx: Transaction) {
    if (!groups[currency]) groups[currency] = [];
    groups[currency].push(tx);
  }

  for (const link of links) {
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
      // "To CAD": deposit the received currency, withdraw the sent currency
      addToGroup(parsed.currency, {
        date,
        description: title,
        amount: parsed.amount,
        type: 'deposit',
        category_name: '',
        external_id,
        notes: parsed.currency,
      });

      if (amountInfoEl) {
        const sourceText = amountInfoEl.textContent?.trim() ?? '';
        const sourceMatch = sourceText.match(/^([\d,]+\.?\d*)\s+([A-Z]{3})$/);
        if (sourceMatch) {
          addToGroup(sourceMatch[2], {
            date,
            description: title,
            amount: parseFloat(sourceMatch[1].replace(/,/g, '')),
            type: 'withdrawal',
            category_name: '',
            external_id: external_id ? `${external_id}-debit` : '',
            notes: sourceMatch[2],
          });
        }
      }
    } else if (!parsed.isDeposit && amountInfoEl) {
      // Auto-converted purchase (e.g. paid 18 CNY but deducted from MYR):
      // the main amount is the merchant's currency — record only the actual wallet deduction
      const sourceText = amountInfoEl.textContent?.trim() ?? '';
      const sourceMatch = sourceText.match(/^([\d,]+\.?\d*)\s+([A-Z]{3})$/);
      if (sourceMatch) {
        addToGroup(sourceMatch[2], {
          date,
          description: title,
          amount: parseFloat(sourceMatch[1].replace(/,/g, '')),
          type: 'withdrawal',
          category_name: '',
          external_id,
          notes: `${parsed.amount} ${parsed.currency}`,
        });
      } else {
        // Fallback: couldn't parse amountInfo, record the main amount as-is
        addToGroup(parsed.currency, {
          date,
          description: title,
          amount: parsed.amount,
          type: 'withdrawal',
          category_name: '',
          external_id,
          notes: parsed.currency,
        });
      }
    } else {
      // Regular transaction (single currency purchase or deposit)
      addToGroup(parsed.currency, {
        date,
        description: title,
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
