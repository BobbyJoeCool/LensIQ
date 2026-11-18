import type { Column, Sort } from '@lensiq/shared';
import { Popover, fieldClass, smallButton } from '../../components/ui';

/** Ordered sort rules; the first rule wins, later ones break ties. */
export function SortMenu({ columns, sorts, onChange }: { columns: Column[]; sorts: Sort[]; onChange: (s: Sort[]) => void }) {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const unused = columns.filter((c) => !sorts.some((s) => s.columnId === c.id));
  return (
    <Popover label={sorts.length ? `Sort (${sorts.length})` : 'Sort'} active={sorts.length > 0}>
      {() => (
        <div className="space-y-2" aria-label="Sorts">
          {sorts.length === 0 && <p className="text-slate-500">No sorting. Rows are in the order they were created.</p>}
          {sorts.map((s, i) => (
            <div key={`${s.columnId}-${i}`} className="flex gap-1.5">
              <select
                aria-label="Sort property"
                className={fieldClass}
                value={byId.has(s.columnId) ? s.columnId : ''}
                onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, columnId: e.target.value } : x)))}
              >
                {!byId.has(s.columnId) && <option value="">(deleted property)</option>}
                {columns.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.id !== s.columnId && sorts.some((x) => x.columnId === c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort direction"
                className={`${fieldClass} w-32`}
                value={s.direction}
                onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as Sort['direction'] } : x)))}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button type="button" aria-label="Remove sort" className={smallButton} onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          {unused[0] && (
            <button type="button" className={smallButton} onClick={() => onChange([...sorts, { columnId: unused[0]!.id, direction: 'asc' }])}>
              + Add sort
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}
