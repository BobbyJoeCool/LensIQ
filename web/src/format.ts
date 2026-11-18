import type { DateValue, NotionColor } from '@lensiq/shared';

const CURRENCIES: Record<string, string> = {
  dollar: 'USD',
  canadian_dollar: 'CAD',
  australian_dollar: 'AUD',
  euro: 'EUR',
  pound: 'GBP',
  yen: 'JPY',
  rupee: 'INR',
  won: 'KRW',
  yuan: 'CNY',
  franc: 'CHF',
  real: 'BRL',
  peso: 'MXN',
};

/** Formats a number using the column's Notion number format. */
export function formatNumber(value: number, format?: string): string {
  if (format && CURRENCIES[format]) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCIES[format] }).format(value);
  }
  if (format === 'percent') {
    // Notion stores 0.25 and shows 25%.
    return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(value);
  }
  if (format === 'number_with_commas') {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }).format(value);
  }
  return String(value);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatOne(iso: string): string {
  if (DATE_ONLY.test(iso)) {
    // Build in local time so "2026-11-01" never shows as Oct 31.
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(value: DateValue): string {
  return value.end ? `${formatOne(value.start)} → ${formatOne(value.end)}` : formatOne(value.start);
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatOne(iso);
}

/** Tailwind classes approximating Notion's option colors, light and dark. */
export const OPTION_COLORS: Record<NotionColor, string> = {
  default: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  gray: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100',
  brown: 'bg-amber-200/70 text-amber-950 dark:bg-amber-900/60 dark:text-amber-100',
  orange: 'bg-orange-200 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
  yellow: 'bg-yellow-200 text-yellow-900 dark:bg-yellow-800/60 dark:text-yellow-100',
  green: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
  blue: 'bg-sky-200 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100',
  purple: 'bg-violet-200 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
  pink: 'bg-pink-200 text-pink-900 dark:bg-pink-900/60 dark:text-pink-100',
  red: 'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100',
};
