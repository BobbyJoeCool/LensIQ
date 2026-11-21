import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as PieCell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartConfig, Column, Row } from '@lensiq/shared';
import { formatNumber } from '../../format';
import { chartData, effectiveLabels, labelBase, valueLabel, type ChartResult, type ValueLabels } from '../chart';

interface Props {
  columns: Column[];
  rows: Row[];
  config: ChartConfig;
  compact?: boolean;
}

const axisTick = { fill: 'var(--chart-axis)', fontSize: 12 };
/** Value labels (#56): text color with a halo in the chart's background color, so they read on any bar or slice. */
const labelStyle = { fill: 'var(--chart-axis)', fontSize: 11, fontWeight: 600, stroke: 'var(--chart-surface)', strokeWidth: 3, paintOrder: 'stroke' } as const;
/** Labels drawn on a colored segment or slice: white text with a thin dark outline, legible on every palette color. */
const insideLabelStyle = { fill: '#ffffff', fontSize: 11, fontWeight: 600, stroke: 'rgba(0, 0, 0, 0.45)', strokeWidth: 2, paintOrder: 'stroke' } as const;
/** Line and area charts label their points only when there are few enough to read. */
export const MAX_LABELED_POINTS = 24;
/** Rough label width, to hide labels that don't fit inside a bar segment or slice. */
const textWidth = (s: string) => s.length * 6.5;

interface Labels {
  mode: ValueLabels;
  base: number;
  fmt: (n: number) => string;
}

/** Draws a chart from chartData(); every rule about the data lives there. */
export function ChartView({ columns, rows, config, compact }: Props) {
  const [showTable, setShowTable] = useState(false);
  const result = chartData(rows, columns, config);
  const yCol = config.aggregation !== 'count' ? columns.find((c) => c.id === config.y) : undefined;
  const fmt = (n: number) => (yCol ? formatNumber(Math.round(n * 100) / 100, yCol.numberFormat) : new Intl.NumberFormat().format(Math.round(n * 100) / 100));
  /** In a dashboard tile the chart fills the tile on desktop (#54); elsewhere it has a fixed height. */
  const fill = compact ? 'md:min-h-0 md:flex-1 md:overflow-auto' : '';

  if (result.kind === 'empty') {
    return <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">{result.reason}</p>;
  }

  if (result.kind === 'stat') {
    return (
      <figure className={`flex flex-col items-start justify-center rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 ${fill}`} aria-label={result.label}>
        <p className="text-sm text-slate-500">{result.label}</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums" data-testid="stat-value">
          {result.value === null ? '—' : fmt(result.value)}
        </p>
        <figcaption className="mt-1 text-xs text-slate-500">
          {result.count} {result.count === 1 ? 'row' : 'rows'}
        </figcaption>
      </figure>
    );
  }

  const labels: Labels = { mode: effectiveLabels(config), base: labelBase(result), fmt };
  return (
    <figure className={`flex flex-col rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 ${fill}`}>
      <div className={`relative ${compact ? 'h-60 md:h-auto md:min-h-40 md:flex-1' : 'h-[360px]'}`} role="img" aria-label={describe(result, config)}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(result, config, fmt, labels)}
        </ResponsiveContainer>
      </div>
      {config.chartType === 'pie' && <PieLegend result={result} fmt={fmt} />}
      <div className="mt-2 flex justify-end">
        <button type="button" className="min-h-8 rounded px-2 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
          {showTable ? 'Hide data' : 'Show data'}
        </button>
      </div>
      {showTable && <DataTable result={result} fmt={fmt} />}
    </figure>
  );
}

function describe(result: Extract<ChartResult, { kind: 'series' }>, config: ChartConfig): string {
  const kind = { bar: 'Bar chart', line: 'Line chart', area: 'Area chart', pie: 'Donut chart', stat: 'Number' }[config.chartType];
  return `${kind} with ${result.data.length} categories and ${result.series.length} ${result.series.length === 1 ? 'series' : 'series'}. Use “Show data” for the values.`;
}

/** A value label inside a stacked segment, or at the end of a bar; hidden when it doesn't fit (#56). */
function barLabel(labels: Labels, inside: boolean, horizontal: boolean) {
  return function BarValueLabel(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown; index?: number }) {
    const [x, y, w, h] = [Number(props.x), Number(props.y), Number(props.width), Number(props.height)];
    const value = Number(props.value);
    if (!Number.isFinite(value) || (inside && value === 0)) return null;
    const text = valueLabel(value, labels.mode, labels.base, labels.fmt);
    if (inside && (textWidth(text) + 4 > w || h < 14)) return null;
    const pos = inside
      ? { x: x + w / 2, y: y + h / 2, textAnchor: 'middle' as const, dominantBaseline: 'central' as const }
      : horizontal
        ? { x: x + w + 4, y: y + h / 2, textAnchor: 'start' as const, dominantBaseline: 'central' as const }
        : { x: x + w / 2, y: y - 4, textAnchor: 'middle' as const, dominantBaseline: 'auto' as const };
    return (
      <text {...pos} {...(inside ? insideLabelStyle : labelStyle)} className="chart-value-label">
        {text}
      </text>
    );
  };
}

function renderChart(result: Extract<ChartResult, { kind: 'series' }>, config: ChartConfig, fmt: (n: number) => string, labels: Labels) {
  const { data, series, categoryColors } = result;
  const multi = series.length > 1;
  const tooltip = (
    <Tooltip
      formatter={(v) => fmt(Number(v))}
      contentStyle={{ background: 'var(--chart-surface)', border: '1px solid var(--chart-grid)', borderRadius: 8, fontSize: 12 }}
      cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }}
    />
  );
  const grid = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />;
  // Legend text stays in the text color; only the swatch carries the series color.
  const legend = multi ? <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: 'var(--chart-axis)' }}>{value}</span>} /> : null;
  // Counts are whole numbers: no 0.5 ticks.
  const allowDecimals = config.aggregation !== 'count';

  if (config.chartType === 'pie') {
    return (
      <PieChart>
        {tooltip}
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={1}
          stroke="var(--chart-surface)"
          strokeWidth={2}
          isAnimationActive={false}
          labelLine={false}
          label={
            labels.mode === 'off'
              ? false
              : (p: { cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number; value?: number; percent?: number }) => {
                  const text = valueLabel(Number(p.value), labels.mode, labels.base, labels.fmt);
                  const [inner, outer] = [Number(p.innerRadius), Number(p.outerRadius)];
                  const r = (inner + outer) / 2;
                  // Hide a label that doesn't fit in its slice (#56): the arc at mid-radius must hold the text.
                  if ((p.percent ?? 0) * 2 * Math.PI * r < textWidth(text) + 6 || outer - inner < 14) return null;
                  const a = (-(p.midAngle ?? 0) * Math.PI) / 180;
                  return (
                    <text x={Number(p.cx) + r * Math.cos(a)} y={Number(p.cy) + r * Math.sin(a)} textAnchor="middle" dominantBaseline="central" {...insideLabelStyle} className="chart-value-label">
                      {text}
                    </text>
                  );
                }
          }
        >
          {data.map((p) => (
            <PieCell key={p.key} fill={categoryColors.get(p.key)} />
          ))}
        </Pie>
      </PieChart>
    );
  }

  if (config.chartType === 'line' || config.chartType === 'area') {
    const Chart = config.chartType === 'line' ? LineChart : AreaChart;
    const pointLabels = labels.mode !== 'off' && data.length <= MAX_LABELED_POINTS;
    return (
      <Chart data={data} margin={{ top: pointLabels ? 20 : 8, right: 12, bottom: 4, left: 4 }}>
        {grid}
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} minTickGap={16} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} width={64} allowDecimals={allowDecimals} />
        {tooltip}
        {legend}
        {series.map((s) =>
          config.chartType === 'line' ? (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={data.length <= 24 ? { r: 4, strokeWidth: 2, stroke: 'var(--chart-surface)', fill: s.color } : false} isAnimationActive={false}>
              {pointLabels && <LabelList dataKey={s.key} position="top" offset={8} formatter={(v: unknown) => labels.fmt(Number(v))} style={labelStyle} className="chart-value-label" />}
            </Line>
          ) : (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.25} stackId={config.stacked ? 'a' : undefined} isAnimationActive={false}>
              {pointLabels && <LabelList dataKey={s.key} position="top" offset={8} formatter={(v: unknown) => labels.fmt(Number(v))} style={labelStyle} className="chart-value-label" />}
            </Area>
          ),
        )}
      </Chart>
    );
  }

  // Bar
  const horizontal = config.horizontal;
  const singleColored = !multi; // one series: each bar wears its category's (option's) color
  const labeled = labels.mode !== 'off';
  // Horizontal bars put labels past the bar's end: leave room for the longest one.
  const endLabelRoom = labeled && horizontal && !(config.stacked && multi)
    ? Math.min(180, Math.max(...data.flatMap((p) => series.map((s) => textWidth(valueLabel(Number(p[s.key]), labels.mode, labels.base, labels.fmt))))) + 12)
    : 12;
  return (
    <BarChart
      data={data}
      layout={horizontal ? 'vertical' : 'horizontal'}
      margin={{ top: labeled && !horizontal ? 20 : 8, right: endLabelRoom, bottom: 4, left: 4 }}
      barCategoryGap="20%"
      barGap={2}
    >
      <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
      {horizontal ? (
        <>
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} allowDecimals={allowDecimals} />
          <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} width={110} />
        </>
      ) : (
        <>
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} width={64} allowDecimals={allowDecimals} />
        </>
      )}
      {tooltip}
      {legend}
      {series.map((s, i) => {
        const last = !config.stacked || i === series.length - 1;
        const radius: [number, number, number, number] = last ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : [0, 0, 0, 0];
        return (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={radius} stackId={config.stacked ? 'a' : undefined} stroke="var(--chart-surface)" strokeWidth={config.stacked ? 1 : 0} isAnimationActive={false}>
            {singleColored && !result.xIsTime && data.map((p) => <PieCell key={p.key} fill={categoryColors.get(p.key)} />)}
            {labeled && <LabelList dataKey={s.key} content={barLabel(labels, !!config.stacked && multi, horizontal)} />}
          </Bar>
        );
      })}
    </BarChart>
  );
}

function PieLegend({ result, fmt }: { result: Extract<ChartResult, { kind: 'series' }>; fmt: (n: number) => string }) {
  const total = result.data.reduce((s, p) => s + Number(p.value), 0);
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
      {result.data.map((p) => (
        <li key={p.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: result.categoryColors.get(p.key) }} aria-hidden />
          <span>{p.label}</span>
          <span className="tabular-nums text-slate-500">
            {fmt(Number(p.value))} ({total ? Math.round((Number(p.value) / total) * 100) : 0}%)
          </span>
        </li>
      ))}
    </ul>
  );
}

function DataTable({ result, fmt }: { result: Extract<ChartResult, { kind: 'series' }>; fmt: (n: number) => string }) {
  return (
    <div className="mt-2 max-h-64 overflow-auto">
      <table className="min-w-full text-xs" aria-label="Chart data">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-semibold">
              Category
            </th>
            {result.series.map((s) => (
              <th key={s.key} scope="col" className="px-2 py-1 text-right font-semibold">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.data.map((p) => (
            <tr key={p.key} className="border-t border-slate-100 dark:border-slate-800">
              <th scope="row" className="px-2 py-1 text-left font-normal">
                {p.label}
              </th>
              {result.series.map((s) => (
                <td key={s.key} className="px-2 py-1 text-right tabular-nums">
                  {fmt(Number(p[s.key]))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
