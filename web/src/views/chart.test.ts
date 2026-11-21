import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '@lensiq/shared';
import { assignColors, bucketOf, chartData, effectiveLabels, formatPercent, labelBase, labelModes, seriesColor, valueLabel } from './chart';
import { columns, rows } from './fixtures';

const base: ChartConfig = {
  filters: [],
  filterMode: 'and',
  sorts: [],
  chartType: 'bar',
  x: 'stat',
  dateGrouping: 'month',
  aggregation: 'count',
  y: null,
  splitBy: null,
  horizontal: false,
  stacked: false,
  cumulative: false,
  sortBy: 'x',
  hideEmpty: false,
};
const chart = (c: Partial<ChartConfig>) => chartData(rows, columns, { ...base, ...c });
const series = (c: Partial<ChartConfig>) => {
  const r = chart(c);
  if (r.kind !== 'series') throw new Error(`expected series, got ${r.kind}`);
  return r;
};

describe('chartData', () => {
  it('counts rows per status in option order, colored by option', () => {
    const r = series({});
    expect(r.data.map((p) => [p.label, p.value])).toEqual([
      ['Applied', 2],
      ['Interviewing', 1],
      ['Offer', 1],
    ]);
    expect(r.categoryColors.get('s1')).toBe(seriesColor(1)); // blue option -> blue slot
    expect(r.categoryColors.get('s3')).toBe(seriesColor(6)); // green option -> green slot
  });

  it('sums, averages, min and max a number column, ignoring empty values', () => {
    expect(series({ aggregation: 'sum', y: 'sal' }).data.map((p) => p.value)).toEqual([120000, 145000, 160000]);
    expect(series({ aggregation: 'avg', y: 'sal' }).data[0]!.value).toBe(120000); // Contoso has no salary
    expect(series({ x: 'rem', aggregation: 'max', y: 'sal' }).data.map((p) => [p.label, p.value])).toEqual([
      ['Remote', 145000],
      ['Not remote', 160000],
    ]);
  });

  it('needs a number column for non-count aggregations', () => {
    expect(chart({ aggregation: 'sum', y: null })).toMatchObject({ kind: 'empty' });
  });

  it('buckets dates by month and fills gaps; undated rows are left out', () => {
    const r = series({ x: 'appl', chartType: 'line' });
    expect(r.xIsTime).toBe(true);
    expect(r.data.map((p) => [p.label, p.value])).toEqual([
      ['Oct 2026', 2],
      ['Nov 2026', 1],
    ]);
    const weekly = series({ x: 'appl', dateGrouping: 'week' });
    expect(weekly.data[0]!.label).toBe('Week of Sep 28'); // Oct 1, 2026 is a Thursday
    expect(weekly.data.length).toBe(7); // Sep 28 .. Nov 9 (Nov 15 is a Sunday), every week present
  });

  it('runs a cumulative total on line charts', () => {
    expect(series({ x: 'appl', chartType: 'line', cumulative: true }).data.map((p) => p.value)).toEqual([2, 3]);
  });

  it('counts a row once per tag for multi-select and shows an empty bucket only when used', () => {
    const r = series({ x: 'tags' });
    expect(r.data.map((p) => [p.label, p.value])).toEqual([
      ['Frontend', 2],
      ['Full stack', 2],
      ['No Tags', 1],
    ]);
  });

  it('splits into series by a select, colored by option', () => {
    const r = series({ x: 'appl', splitBy: 'stat' });
    expect(r.series.map((s) => s.label)).toEqual(['Applied', 'Interviewing']); // Offer has no dated rows
    expect(r.data[0]).toMatchObject({ label: 'Oct 2026', s1: 1, s2: 1 });
    expect(r.series[0]!.color).toBe(seriesColor(1));
  });

  it('sorts categories by value and hides empty ones', () => {
    const r = series({ x: 'city', sortBy: 'value' });
    expect(r.data[0]!.label).toBe('Austin'); // tie order is stable; each city is one row
    expect(series({ x: 'stat', hideEmpty: true, aggregation: 'sum', y: 'sal' }).data).toHaveLength(3);
  });

  it('computes stat tiles', () => {
    expect(chart({ chartType: 'stat' })).toMatchObject({ kind: 'stat', value: 4, label: 'Count' });
    expect(chart({ chartType: 'stat', aggregation: 'sum', y: 'sal' })).toMatchObject({ value: 425000, label: 'Sum of Salary' });
    expect(chartData([], columns, { ...base, chartType: 'stat', aggregation: 'avg', y: 'sal' })).toMatchObject({ value: null });
  });

  it('pie drops empty slices and ignores split', () => {
    const r = series({ chartType: 'pie', splitBy: 'rem' });
    expect(r.series).toHaveLength(1);
    expect(r.data.every((p) => Number(p.value) > 0)).toBe(true);
  });

  it('asks for an x-axis when none is set', () => {
    expect(chart({ x: null })).toMatchObject({ kind: 'empty', reason: expect.stringContaining('x-axis') });
  });
});

describe('assignColors', () => {
  it('maps Notion colors to their hue, then fills free slots in order, never cycling', () => {
    const c = assignColors([
      { key: 'a', notionColor: 'green' },
      { key: 'b', notionColor: 'default' },
      { key: 'c' },
    ]);
    expect(c.get('a')).toBe(seriesColor(6));
    expect(c.get('b')).toBe(seriesColor(1));
    expect(c.get('c')).toBe(seriesColor(2));
    const many = assignColors(Array.from({ length: 10 }, (_, i) => ({ key: String(i) })));
    expect(many.get('8')).toBe('var(--series-other)');
  });
});

describe('bucketOf', () => {
  it('starts weeks on Monday', () => {
    expect(bucketOf('2026-11-22', 'week')).toBe('2026-11-16'); // Sunday -> previous Monday
    expect(bucketOf('2026-11-16', 'week')).toBe('2026-11-16');
    expect(bucketOf('2026-11-16', 'year')).toBe('2026');
  });
});

describe('value labels (#56)', () => {
  const fmt = (n: number) => String(n);

  it('offers percent only for count and sum on bar and donut charts', () => {
    expect(labelModes({ ...base })).toEqual(['off', 'value', 'percent', 'both']);
    expect(labelModes({ ...base, chartType: 'pie', aggregation: 'sum', y: 'sal' })).toEqual(['off', 'value', 'percent', 'both']);
    expect(labelModes({ ...base, aggregation: 'avg', y: 'sal' })).toEqual(['off', 'value']);
    expect(labelModes({ ...base, chartType: 'line' })).toEqual(['off', 'value']);
    expect(labelModes({ ...base, chartType: 'stat' })).toEqual(['off']);
  });

  it('falls back to plain values when a saved mode no longer applies, and is off by default', () => {
    expect(effectiveLabels(base)).toBe('off');
    expect(effectiveLabels({ ...base, showValues: 'both' })).toBe('both');
    expect(effectiveLabels({ ...base, chartType: 'line', showValues: 'percent' })).toBe('value');
  });

  it('percent is out of the whole chart, so the labels add up to 100%', () => {
    expect(labelBase(series({}))).toBe(4);
    expect(labelBase(series({ splitBy: 'rem', stacked: true }))).toBe(4); // every segment of every bar
    expect(labelBase(series({ x: 'tags' }))).toBe(5); // a row with two tags is in two bars
  });

  it('writes the value, the percent, or both', () => {
    expect(valueLabel(2, 'value', 4, fmt)).toBe('2');
    expect(valueLabel(2, 'percent', 4, fmt)).toBe('50%');
    expect(valueLabel(1, 'both', 3, fmt)).toBe('1 (33%)');
    expect(valueLabel(2, 'off', 4, fmt)).toBe('');
    expect(valueLabel(1250.5, 'value', 0, (n) => `$${n.toFixed(2)}`)).toBe('$1250.50');
  });

  it('rounds percents, shows slivers as <1% and never divides by zero', () => {
    expect(formatPercent(1, 3)).toBe('33%');
    expect(formatPercent(2, 3)).toBe('67%');
    expect(formatPercent(1, 400)).toBe('<1%');
    expect(formatPercent(0, 10)).toBe('0%');
    expect(formatPercent(5, 0)).toBe('0%');
  });
});
