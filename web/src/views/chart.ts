/**
 * Turns rows plus chart settings into plot-ready data. Pure, so every chart
 * rule is unit-tested here; the chart components only draw the result.
 */
import type { ChartConfig, Column, NotionColor, Row, SelectOption } from '@lensiq/shared';
import { addDays, cellDay, cellNumber, cellText, columnKind, dayOf, isEmptyCell } from './query';

/**
 * Categorical palette: eight fixed slots, validated for color-vision
 * deficiency in light and dark mode (values in index.css as --series-1..8).
 * Notion option colors map to the matching hue so an option keeps "its"
 * color; anything else takes the next free slot in fixed order. Never cycled:
 * a ninth category folds into "Other".
 */
const SLOT_BY_NOTION: Partial<Record<NotionColor, number>> = {
  blue: 1,
  orange: 2,
  yellow: 4,
  pink: 5,
  green: 6,
  purple: 7,
  red: 8,
};
export const MAX_SERIES = 8;
export const seriesColor = (slot: number) => `var(--series-${slot})`;
export const OTHER_COLOR = 'var(--series-other)';
export const OTHER_KEY = '__other';
export const NONE_KEY = '__none';
export const TOTAL_KEY = '__total';
export const TOTAL_COLOR = 'var(--chart-total)';

/** Assigns palette slots: Notion colors first, then free slots in order. */
export function assignColors(items: { key: string; notionColor?: NotionColor }[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<number>();
  for (const it of items) {
    const slot = it.notionColor ? SLOT_BY_NOTION[it.notionColor] : undefined;
    if (slot && !used.has(slot)) {
      used.add(slot);
      out.set(it.key, seriesColor(slot));
    }
  }
  let next = 1;
  for (const it of items) {
    if (out.has(it.key)) continue;
    if (it.key === OTHER_KEY || it.key === NONE_KEY) {
      out.set(it.key, OTHER_COLOR);
      continue;
    }
    while (used.has(next) && next <= MAX_SERIES) next++;
    if (next > MAX_SERIES) {
      out.set(it.key, OTHER_COLOR);
      continue;
    }
    used.add(next);
    out.set(it.key, seriesColor(next));
  }
  return out;
}

export interface Category {
  key: string;
  label: string;
  color?: string;
}

export interface Series {
  key: string;
  label: string;
  color: string;
}

export type ChartResult =
  | { kind: 'stat'; value: number | null; label: string; count: number }
  | {
      kind: 'series';
      /** One entry per x category, with a number per series key. */
      data: (Record<string, number | string> & { key: string; label: string })[];
      series: Series[];
      /** Per-category colors (pie, or a single-series bar colored by option). */
      categoryColors: Map<string, string>;
      xIsTime: boolean;
      /**
       * The chart's total (#52): every row on the chart counted once (count),
       * or the sum of their values (sum). Null for average, min and max.
       */
      total: number | null;
    }
  | { kind: 'empty'; reason: string };

const AGG_LABEL: Record<ChartConfig['aggregation'], string> = {
  count: 'Count',
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
};

export function aggregationLabel(config: ChartConfig, columns: Column[]): string {
  if (config.aggregation === 'count') return 'Count';
  const y = columns.find((c) => c.id === config.y);
  return `${AGG_LABEL[config.aggregation]} of ${y?.name ?? '?'}`;
}

/** Count and sum add up across categories; average, min and max don't. */
export const isAdditive = (config: ChartConfig) => config.aggregation === 'count' || config.aggregation === 'sum';

/** Running aggregate for one bucket. */
class Acc {
  n = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  rows = 0;
  add(v: number | null, counting: boolean) {
    this.rows++;
    if (counting) return;
    if (v === null) return;
    this.n++;
    this.sum += v;
    this.min = Math.min(this.min, v);
    this.max = Math.max(this.max, v);
  }
  merge(a: Acc) {
    this.rows += a.rows;
    this.n += a.n;
    this.sum += a.sum;
    this.min = Math.min(this.min, a.min);
    this.max = Math.max(this.max, a.max);
  }
  value(agg: ChartConfig['aggregation']): number {
    switch (agg) {
      case 'count':
        return this.rows;
      case 'sum':
        return this.sum;
      case 'avg':
        return this.n ? this.sum / this.n : 0;
      case 'min':
        return this.n ? this.min : 0;
      case 'max':
        return this.n ? this.max : 0;
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bucket key for a calendar day: weeks start on Monday. */
export function bucketOf(day: string, grouping: ChartConfig['dateGrouping']): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  switch (grouping) {
    case 'day':
      return day;
    case 'week': {
      const date = new Date(y, m - 1, d);
      const offset = (date.getDay() + 6) % 7; // Monday = 0
      return dayOf(new Date(y, m - 1, d - offset));
    }
    case 'month':
      return `${y}-${String(m).padStart(2, '0')}`;
    case 'year':
      return String(y);
  }
}

export function bucketLabel(key: string, grouping: ChartConfig['dateGrouping']): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number?, number?];
  switch (grouping) {
    case 'day':
      return `${MONTHS[m! - 1]} ${d}, ${y}`;
    case 'week':
      return `Week of ${MONTHS[m! - 1]} ${d}`;
    case 'month':
      return `${MONTHS[m! - 1]} ${y}`;
    case 'year':
      return String(y);
  }
}

function nextBucket(key: string, grouping: ChartConfig['dateGrouping']): string {
  switch (grouping) {
    case 'day':
      return addDays(key, 1);
    case 'week':
      return addDays(key, 7);
    case 'month': {
      const [y, m] = key.split('-').map(Number) as [number, number];
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    case 'year':
      return String(Number(key) + 1);
  }
}

const MAX_BUCKETS = 400;
const MAX_TEXT_CATEGORIES = 20;

/** Categories a row falls into on a given column (several for multi-select). */
function keysFor(row: Row, column: Column, kind: ReturnType<typeof columnKind>, grouping: ChartConfig['dateGrouping']): string[] {
  const v = row.cells[column.id];
  if (kind === 'date') {
    const day = cellDay(v);
    return day ? [bucketOf(day, grouping)] : [NONE_KEY];
  }
  if (kind === 'select') return v?.kind === 'select' && v.value ? [v.value.id] : [NONE_KEY];
  if (kind === 'multi') return v?.kind === 'multi_select' && v.value.length ? v.value.map((o) => o.id) : [NONE_KEY];
  if (kind === 'checkbox') return [v?.kind === 'boolean' && v.value ? 'true' : 'false'];
  if (isEmptyCell(v)) return [NONE_KEY];
  return [cellText(v)];
}

function optionCategories(options: SelectOption[] | undefined): Category[] {
  return (options ?? []).map((o) => ({ key: o.id, label: o.name }));
}

/** Builds chart data for the given rows (already filtered by the view). */
export function chartData(rows: Row[], columns: Column[], config: ChartConfig): ChartResult {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const counting = config.aggregation === 'count';
  const yCol = config.y ? byId.get(config.y) : undefined;
  if (!counting && !yCol) return { kind: 'empty', reason: 'Choose a number property to aggregate.' };
  const yValue = (r: Row) => (yCol ? cellNumber(r.cells[yCol.id]) : null);

  if (config.chartType === 'stat') {
    const acc = new Acc();
    for (const r of rows) acc.add(yValue(r), counting);
    const value = !counting && acc.n === 0 ? null : acc.value(config.aggregation);
    return { kind: 'stat', value, label: aggregationLabel(config, columns), count: rows.length };
  }

  const xCol = config.x ? byId.get(config.x) : undefined;
  if (!xCol) return { kind: 'empty', reason: 'Choose a property for the x-axis.' };
  const xKind = columnKind(xCol, rows);
  const xIsTime = xKind === 'date';

  // Series split (not for pie).
  const splitCol = config.chartType !== 'pie' && config.splitBy ? byId.get(config.splitBy) : undefined;
  const splitKind = splitCol ? columnKind(splitCol, rows) : null;

  // Aggregate into buckets[xKey][seriesKey].
  const buckets = new Map<string, Map<string, Acc>>();
  const seriesSeen = new Map<string, number>(); // series key -> rows, for "Other" folding
  // Totals (#52): each row on the chart once, overall and per series (a multi-select x counts a row once, not per option).
  const overall = new Acc();
  const seriesTotals = new Map<string, Acc>();
  for (const r of rows) {
    const xs = keysFor(r, xCol, xKind, config.dateGrouping);
    const ss = splitCol ? keysFor(r, splitCol, splitKind!, config.dateGrouping) : ['value'];
    const y = yValue(r);
    if (xs.some((x) => !(xIsTime && x === NONE_KEY))) {
      overall.add(y, counting);
      for (const s of ss) {
        let acc = seriesTotals.get(s);
        if (!acc) seriesTotals.set(s, (acc = new Acc()));
        acc.add(y, counting);
      }
    }
    for (const x of xs) {
      if (xIsTime && x === NONE_KEY) continue; // undated rows don't belong on a time axis
      let row = buckets.get(x);
      if (!row) buckets.set(x, (row = new Map()));
      for (const s of ss) {
        let acc = row.get(s);
        if (!acc) row.set(s, (acc = new Acc()));
        acc.add(y, counting);
        seriesSeen.set(s, (seriesSeen.get(s) ?? 0) + 1);
      }
    }
  }

  // Categories in display order.
  let categories: Category[];
  if (xIsTime) {
    const keys = [...buckets.keys()].sort();
    if (keys.length === 0) return { kind: 'empty', reason: `No rows have a ${xCol.name} date.` };
    categories = [];
    // Fill gaps so time runs evenly.
    for (let k = keys[0]!, i = 0; k <= keys.at(-1)! && i < MAX_BUCKETS; k = nextBucket(k, config.dateGrouping), i++) {
      categories.push({ key: k, label: bucketLabel(k, config.dateGrouping) });
    }
  } else if (xKind === 'select' || xKind === 'multi') {
    categories = optionCategories(xCol.options);
    // Options seen in rows but missing from the cached schema still show.
    for (const k of buckets.keys()) {
      if (k !== NONE_KEY && !categories.some((c) => c.key === k)) {
        const opt = rows.flatMap((r) => {
          const v = r.cells[xCol.id];
          return v?.kind === 'select' && v.value ? [v.value] : v?.kind === 'multi_select' ? v.value : [];
        }).find((o) => o.id === k);
        categories.push({ key: k, label: opt?.name ?? k });
      }
    }
    if (xCol.type !== 'status' || buckets.has(NONE_KEY)) categories.push({ key: NONE_KEY, label: `No ${xCol.name}` });
  } else if (xKind === 'checkbox') {
    categories = [
      { key: 'true', label: xCol.name },
      { key: 'false', label: `Not ${xCol.name.toLowerCase()}` },
    ];
  } else {
    const keys = [...buckets.keys()].filter((k) => k !== NONE_KEY);
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    categories = keys.sort(collator.compare).map((k) => ({ key: k, label: k }));
    if (buckets.has(NONE_KEY)) categories.push({ key: NONE_KEY, label: `No ${xCol.name}` });
  }

  // Series list (split values, capped at MAX_SERIES with the rest folded into Other).
  let series: { key: string; label: string; notionColor?: NotionColor }[];
  if (!splitCol) {
    series = [{ key: 'value', label: aggregationLabel(config, columns) }];
  } else {
    let all: { key: string; label: string; notionColor?: NotionColor }[];
    if (splitKind === 'select' || splitKind === 'multi') {
      all = (splitCol.options ?? []).map((o) => ({ key: o.id, label: o.name, notionColor: o.color }));
      if (seriesSeen.has(NONE_KEY)) all.push({ key: NONE_KEY, label: `No ${splitCol.name}` });
    } else if (splitKind === 'checkbox') {
      all = [
        { key: 'true', label: splitCol.name },
        { key: 'false', label: `Not ${splitCol.name.toLowerCase()}` },
      ];
    } else {
      all = [...seriesSeen.keys()].map((k) => ({ key: k, label: k === NONE_KEY ? `No ${splitCol.name}` : k }));
    }
    all = all.filter((s) => seriesSeen.has(s.key));
    if (all.length > MAX_SERIES) {
      const ranked = [...all].sort((a, b) => (seriesSeen.get(b.key) ?? 0) - (seriesSeen.get(a.key) ?? 0));
      const keep = new Set(ranked.slice(0, MAX_SERIES - 1).map((s) => s.key));
      const folded = all.filter((s) => !keep.has(s.key)).map((s) => s.key);
      for (const row of [...buckets.values(), seriesTotals]) {
        const other = new Acc();
        for (const k of folded) {
          const a = row.get(k);
          if (!a) continue;
          other.merge(a);
          row.delete(k);
        }
        if (other.rows) row.set(OTHER_KEY, other);
      }
      all = [...all.filter((s) => keep.has(s.key)), { key: OTHER_KEY, label: 'Other' }];
    }
    series = all;
  }
  const seriesColors = assignColors(series);

  // Data rows.
  let data = categories.map((c) => {
    const row = buckets.get(c.key);
    const point: Record<string, number | string> & { key: string; label: string } = { key: c.key, label: c.label };
    for (const s of series) point[s.key] = row?.get(s.key)?.value(config.aggregation) ?? 0;
    return point;
  });

  const total = (p: Record<string, number | string>) => series.reduce((sum, s) => sum + (Number(p[s.key]) || 0), 0);

  if (!xIsTime) {
    // Too many free-text categories: keep the biggest, fold the rest.
    if (xKind !== 'select' && xKind !== 'multi' && xKind !== 'checkbox' && data.length > MAX_TEXT_CATEGORIES) {
      const ranked = [...data].sort((a, b) => total(b) - total(a));
      const keep = new Set(ranked.slice(0, MAX_TEXT_CATEGORIES - 1).map((p) => p.key));
      const rest = data.filter((p) => !keep.has(p.key));
      const other: Record<string, number | string> & { key: string; label: string } = { key: OTHER_KEY, label: 'Other' };
      // Only additive aggregations can be folded honestly; others drop the tail.
      if (config.aggregation === 'count' || config.aggregation === 'sum') {
        for (const s of series) other[s.key] = rest.reduce((sum, p) => sum + (Number(p[s.key]) || 0), 0);
        data = [...data.filter((p) => keep.has(p.key)), other];
      } else {
        data = data.filter((p) => keep.has(p.key));
      }
    }
    if (config.hideEmpty || config.chartType === 'pie') data = data.filter((p) => total(p) !== 0);
    // The "No value" bucket only shows when it has rows.
    data = data.filter((p) => p.key !== NONE_KEY || total(p) !== 0);
    if (config.sortBy === 'value') data = [...data].sort((a, b) => total(b) - total(a));
  } else if (config.cumulative && (config.chartType === 'line' || config.chartType === 'area')) {
    const running = new Map<string, number>();
    data = data.map((p) => {
      const q = { ...p };
      for (const s of series) {
        const next = (running.get(s.key) ?? 0) + (Number(p[s.key]) || 0);
        running.set(s.key, next);
        q[s.key] = next;
      }
      return q;
    });
  }

  if (data.length === 0) return { kind: 'empty', reason: 'No rows match this chart.' };

  // Category colors: option colors for select-like x (pie slices, single-series bars).
  const optionColor = new Map((xCol.options ?? []).map((o) => [o.id, o.color]));
  const categoryColors = assignColors(data.map((p) => ({ key: p.key, notionColor: optionColor.get(p.key) })));

  // Total bar (#52): last, split like the other bars, in a neutral color when there's one series.
  const additive = isAdditive(config);
  if (config.showTotal && additive && config.chartType === 'bar') {
    const point: Record<string, number | string> & { key: string; label: string } = { key: TOTAL_KEY, label: 'Total' };
    for (const s of series) point[s.key] = seriesTotals.get(s.key)?.value(config.aggregation) ?? 0;
    data = [...data, point];
    categoryColors.set(TOTAL_KEY, TOTAL_COLOR);
  }

  return {
    kind: 'series',
    data,
    series: series.map((s) => ({ key: s.key, label: s.label, color: seriesColors.get(s.key)! })),
    categoryColors,
    xIsTime,
    total: additive ? overall.value(config.aggregation) : null,
  };
}

export type ValueLabels = NonNullable<ChartConfig['showValues']>;

/**
 * Which value labels a chart can show (#56): percent only makes sense where
 * values add up to a whole (count or sum, on bar and donut charts).
 */
export function labelModes(config: ChartConfig): ValueLabels[] {
  if (config.chartType === 'stat') return ['off'];
  const percent = isAdditive(config) && (config.chartType === 'bar' || config.chartType === 'pie');
  return percent ? ['off', 'value', 'percent', 'both'] : ['off', 'value'];
}

/** The label mode actually drawn: a saved mode the chart can't show falls back to plain values. */
export function effectiveLabels(config: ChartConfig): ValueLabels {
  const mode = config.showValues ?? 'off';
  return labelModes(config).includes(mode) ? mode : mode === 'off' ? 'off' : 'value';
}

/** The whole the percent labels are out of: every value on the chart, not counting the Total bar. */
export function labelBase(result: Extract<ChartResult, { kind: 'series' }>): number {
  return result.data
    .filter((p) => p.key !== TOTAL_KEY)
    .reduce((sum, p) => sum + result.series.reduce((s, ser) => s + (Number(p[ser.key]) || 0), 0), 0);
}

/** "35%", or "<1%" for a sliver, of `base`. */
export function formatPercent(value: number, base: number): string {
  if (!base || !value) return '0%';
  const pct = (value / base) * 100;
  return pct > 0 && pct < 0.5 ? '<1%' : `${Math.round(pct)}%`;
}

/** Label text for one value (#56): "6", "35%" or "6 (35%)". The Total bar always shows just its value. */
export function valueLabel(value: number, mode: ValueLabels, base: number, fmt: (n: number) => string, isTotal = false): string {
  if (mode === 'off') return '';
  if (mode === 'value' || isTotal) return fmt(value);
  if (mode === 'percent') return formatPercent(value, base);
  return `${fmt(value)} (${formatPercent(value, base)})`;
}
