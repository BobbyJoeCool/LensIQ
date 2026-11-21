import type { BoardConfig, CalendarConfig, ChartConfig, ChartType, Column, Row, TableConfig } from '@lensiq/shared';
import { Popover, SelectField, Toggle, smallButton } from '../../components/ui';
import { columnKind } from '../query';
import { COLOR_BY_TYPES, colorColumn } from '../calendar';
import { effectiveLabels, labelModes, type ValueLabels } from '../chart';

const VALUE_LABELS: Record<ValueLabels, string> = { off: 'Off', value: 'Value', percent: 'Percent', both: 'Value and percent' };

/** Table: show or hide properties. The title always shows. */
export function PropertiesMenu({ columns, config, onChange }: { columns: Column[]; config: TableConfig; onChange: (c: TableConfig) => void }) {
  const hidden = new Set(config.hidden);
  const toggle = (id: string, show: boolean) => {
    const next = new Set(hidden);
    if (show) next.delete(id);
    else next.add(id);
    onChange({ ...config, hidden: [...next] });
  };
  return (
    <Popover label={hidden.size ? `Properties (${hidden.size} hidden)` : 'Properties'} active={hidden.size > 0}>
      {() => (
        <div className="space-y-1" aria-label="Properties">
          <div className="flex justify-end gap-1">
            <button type="button" className={smallButton} onClick={() => onChange({ ...config, hidden: [] })}>
              Show all
            </button>
            <button type="button" className={smallButton} onClick={() => onChange({ ...config, hidden: columns.filter((c) => c.type !== 'title').map((c) => c.id) })}>
              Hide all
            </button>
          </div>
          {columns.map((c) => (
            <Toggle key={c.id} label={c.name} checked={c.type === 'title' || !hidden.has(c.id)} onChange={(v) => c.type !== 'title' && toggle(c.id, v)} />
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Calendar: which date property places rows. */
export function CalendarSettings({ columns, config, onChange }: { columns: Column[]; config: CalendarConfig; onChange: (c: CalendarConfig) => void }) {
  const dates = columns.filter((c) => c.type === 'date' || c.type === 'created_time' || c.type === 'last_edited_time');
  const colorable = columns.filter((c) => COLOR_BY_TYPES.has(c.type));
  return (
    <Popover label="Calendar settings">
      {() => (
        <div className="space-y-2" aria-label="Calendar settings">
          <SelectField
            label="Show rows by"
            value={config.dateColumn}
            options={[{ value: '', label: dates.length ? 'Choose a date property' : 'No date properties' }, ...dates.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(dateColumn) => onChange({ ...config, dateColumn })}
          />
          <SelectField
            label="Color by"
            value={colorColumn(columns, config)?.id ?? null}
            options={[{ value: '', label: 'None' }, ...colorable.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(colorBy) => onChange({ ...config, colorBy })}
          />
          <p className="text-xs text-slate-500">Drag a row to another day to change its date. Created and edited times can't be changed.</p>
        </div>
      )}
    </Popover>
  );
}

/** Board: group by a select or status, choose card fields. */
export function BoardSettings({ columns, config, onChange }: { columns: Column[]; config: BoardConfig; onChange: (c: BoardConfig) => void }) {
  const groupable = columns.filter((c) => c.type === 'select' || c.type === 'status');
  const fields = new Set(config.cardFields);
  return (
    <Popover label="Board settings" active={false}>
      {() => (
        <div className="space-y-3" aria-label="Board settings">
          <SelectField
            label="Group by"
            value={config.groupBy}
            options={[{ value: '', label: groupable.length ? 'Choose a property' : 'No select or status properties' }, ...groupable.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(groupBy) => onChange({ ...config, groupBy })}
          />
          <Toggle label="Hide empty groups" checked={config.hideEmptyGroups} onChange={(hideEmptyGroups) => onChange({ ...config, hideEmptyGroups })} />
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Show on cards</p>
            {columns
              .filter((c) => c.type !== 'title' && c.id !== config.groupBy)
              .map((c) => (
                <Toggle
                  key={c.id}
                  label={c.name}
                  checked={fields.has(c.id)}
                  onChange={(v) => onChange({ ...config, cardFields: v ? [...config.cardFields, c.id] : config.cardFields.filter((id) => id !== c.id) })}
                />
              ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Donut' },
  { value: 'stat', label: 'Number' },
];

/** Chart: type, axes, aggregation, split and display options (Q17). */
export function ChartSettings({ columns, rows, config, onChange }: { columns: Column[]; rows: Row[]; config: ChartConfig; onChange: (c: ChartConfig) => void }) {
  const kinds = new Map(columns.map((c) => [c.id, columnKind(c, rows)]));
  const xOptions = columns.filter((c) => ['select', 'multi', 'checkbox', 'date', 'text', 'number'].includes(kinds.get(c.id)!));
  const numberColumns = columns.filter((c) => kinds.get(c.id) === 'number');
  const splitOptions = columns.filter((c) => ['select', 'multi', 'checkbox'].includes(kinds.get(c.id)!) && c.id !== config.x);
  const xIsDate = config.x ? kinds.get(config.x) === 'date' : false;
  const set = (patch: Partial<ChartConfig>) => onChange({ ...config, ...patch });
  const t = config.chartType;

  return (
    <Popover label="Chart settings">
      {() => (
        <div className="grid grid-cols-2 gap-3" aria-label="Chart settings">
          <div className="col-span-2">
            <p className="mb-1 text-xs font-medium text-slate-500">Chart type</p>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Chart type">
              {CHART_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  type="button"
                  role="radio"
                  aria-checked={t === ct.value}
                  onClick={() => set({ chartType: ct.value })}
                  className={`min-h-9 rounded-md border px-3 text-sm ${t === ct.value ? 'border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100' : 'border-slate-300 dark:border-slate-600'}`}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>
          {t !== 'stat' && (
            <div className="col-span-2">
              <SelectField
                label={t === 'pie' ? 'Slices' : 'X-axis'}
                value={config.x}
                options={[{ value: '', label: 'Choose a property' }, ...xOptions.map((c) => ({ value: c.id, label: c.name }))]}
                onChange={(x) => set({ x, splitBy: config.splitBy === x ? null : config.splitBy })}
              />
            </div>
          )}
          {t !== 'stat' && xIsDate && (
            <SelectField
              label="Group dates by"
              value={config.dateGrouping}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
                { value: 'year', label: 'Year' },
              ]}
              onChange={(v) => set({ dateGrouping: v ?? 'month' })}
            />
          )}
          <SelectField
            label={t === 'stat' ? 'Show' : 'Y-axis'}
            value={config.aggregation}
            options={[
              { value: 'count', label: 'Count of rows' },
              { value: 'sum', label: 'Sum' },
              { value: 'avg', label: 'Average' },
              { value: 'min', label: 'Minimum' },
              { value: 'max', label: 'Maximum' },
            ]}
            onChange={(v) => set({ aggregation: v ?? 'count', y: v && v !== 'count' && !config.y ? (numberColumns[0]?.id ?? null) : config.y })}
          />
          {config.aggregation !== 'count' && (
            <SelectField
              label="Of"
              value={config.y}
              options={[{ value: '', label: numberColumns.length ? 'Choose a number' : 'No number properties' }, ...numberColumns.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={(y) => set({ y })}
            />
          )}
          {(t === 'bar' || t === 'line' || t === 'area') && (
            <div className="col-span-2">
              <SelectField
                label="Split by"
                value={config.splitBy}
                options={[{ value: '', label: 'None' }, ...splitOptions.map((c) => ({ value: c.id, label: c.name }))]}
                onChange={(splitBy) => set({ splitBy })}
              />
            </div>
          )}
          {(t === 'bar' || t === 'pie') && !xIsDate && (
            <SelectField
              label="Order"
              value={config.sortBy}
              options={[
                { value: 'x', label: 'By category' },
                { value: 'value', label: 'Largest first' },
              ]}
              onChange={(v) => set({ sortBy: v ?? 'x' })}
            />
          )}
          {t !== 'stat' && (
            <SelectField
              label="Show values"
              value={effectiveLabels(config)}
              options={labelModes(config).map((m) => ({ value: m, label: VALUE_LABELS[m] }))}
              onChange={(v) => set({ showValues: v ?? 'off' })}
            />
          )}
          <div className="col-span-2 grid grid-cols-2 gap-x-3">
            {t === 'bar' && <Toggle label="Horizontal" checked={config.horizontal} onChange={(horizontal) => set({ horizontal })} />}
            {(t === 'bar' || t === 'area') && config.splitBy && <Toggle label="Stacked" checked={config.stacked} onChange={(stacked) => set({ stacked })} />}
            {(t === 'line' || t === 'area') && xIsDate && <Toggle label="Cumulative" checked={config.cumulative} onChange={(cumulative) => set({ cumulative })} />}
            {t === 'bar' && !xIsDate && <Toggle label="Hide empty" checked={config.hideEmpty} onChange={(hideEmpty) => set({ hideEmpty })} />}
          </div>
        </div>
      )}
    </Popover>
  );
}
