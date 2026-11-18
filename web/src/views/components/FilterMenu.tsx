import type { Column, Filter, FilterOp, Row } from '@lensiq/shared';
import { Field, Popover, fieldClass, smallButton } from '../../components/ui';
import { NO_VALUE_OPS, OPS_BY_KIND, OP_LABELS, columnKind } from '../query';

let seq = 0;
const newId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

interface Props {
  columns: Column[];
  rows: Row[];
  filters: Filter[];
  filterMode: 'and' | 'or';
  onChange: (filters: Filter[], filterMode: 'and' | 'or') => void;
}

/** Notion-style filter list: property, operator, value; combined with "and" or "or". */
export function FilterMenu({ columns, rows, filters, filterMode, onChange }: Props) {
  const filterable = columns.filter((c) => columnKind(c, rows) !== 'other' || c.type === 'relation' || c.type === 'files');
  const byId = new Map(columns.map((c) => [c.id, c]));
  const set = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)), filterMode);
  const add = () => {
    const col = filterable[0];
    if (!col) return;
    onChange([...filters, { id: newId(), columnId: col.id, op: OPS_BY_KIND[columnKind(col, rows)][0]! }], filterMode);
  };
  const label = filters.length ? `Filter (${filters.length})` : 'Filter';

  return (
    <Popover label={label} active={filters.length > 0}>
      {() => (
        <div className="space-y-3" aria-label="Filters">
          {filters.length === 0 && <p className="text-slate-500">No filters. Rows are filtered in the app; Notion isn’t changed.</p>}
          {filters.length > 1 && (
            <Field label="Show rows that match">
              <select
                className={fieldClass}
                value={filterMode}
                onChange={(e) => onChange(filters, e.target.value as 'and' | 'or')}
              >
                <option value="and">all filters (and)</option>
                <option value="or">any filter (or)</option>
              </select>
            </Field>
          )}
          {filters.map((f, i) => {
            const col = byId.get(f.columnId);
            const kind = col ? columnKind(col, rows) : 'other';
            const ops = OPS_BY_KIND[kind];
            return (
              <fieldset key={f.id} className="space-y-1.5 rounded-md border border-slate-200 p-2 dark:border-slate-700">
                <legend className="sr-only">Filter {i + 1}</legend>
                <div className="flex gap-1.5">
                  <select
                    aria-label="Filter property"
                    className={fieldClass}
                    value={col ? f.columnId : ''}
                    onChange={(e) => {
                      const next = byId.get(e.target.value)!;
                      set(i, { columnId: next.id, op: OPS_BY_KIND[columnKind(next, rows)][0]!, value: undefined });
                    }}
                  >
                    {!col && <option value="">(deleted property)</option>}
                    {filterable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" aria-label="Remove filter" className={smallButton} onClick={() => onChange(filters.filter((_, j) => j !== i), filterMode)}>
                    ×
                  </button>
                </div>
                <select
                  aria-label="Filter condition"
                  className={fieldClass}
                  value={f.op}
                  onChange={(e) => set(i, { op: e.target.value as FilterOp, value: undefined })}
                >
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                {col && !NO_VALUE_OPS.has(f.op) && <FilterValue column={col} filter={f} kind={kind} onChange={(value) => set(i, { value })} />}
              </fieldset>
            );
          })}
          <button type="button" className={smallButton} onClick={add} disabled={!filterable.length}>
            + Add filter
          </button>
        </div>
      )}
    </Popover>
  );
}

function FilterValue({ column, filter, kind, onChange }: { column: Column; filter: Filter; kind: string; onChange: (v: Filter['value']) => void }) {
  if (kind === 'select' || kind === 'multi') {
    const chosen = new Set(Array.isArray(filter.value) ? filter.value : []);
    return (
      <div className="max-h-40 space-y-0.5 overflow-auto" role="group" aria-label="Filter options">
        {(column.options ?? []).map((o) => (
          <label key={o.id} className="flex min-h-8 items-center gap-2">
            <input
              type="checkbox"
              className="accent-sky-600"
              checked={chosen.has(o.id)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(o.id);
                else next.delete(o.id);
                onChange([...next]);
              }}
            />
            {o.name}
          </label>
        ))}
      </div>
    );
  }
  if (kind === 'date' && (filter.op === 'past_days' || filter.op === 'next_days')) {
    return (
      <input aria-label="Filter value" type="number" min={0} className={fieldClass} value={filter.value === undefined ? '' : String(filter.value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    );
  }
  if (kind === 'date') {
    return <input aria-label="Filter value" type="date" className={fieldClass} value={typeof filter.value === 'string' ? filter.value : ''} onChange={(e) => onChange(e.target.value || undefined)} />;
  }
  if (kind === 'number') {
    return (
      <input aria-label="Filter value" type="number" className={fieldClass} value={filter.value === undefined ? '' : String(filter.value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    );
  }
  return <input aria-label="Filter value" className={fieldClass} value={typeof filter.value === 'string' ? filter.value : ''} onChange={(e) => onChange(e.target.value)} />;
}
