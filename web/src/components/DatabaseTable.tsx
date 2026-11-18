import { useState, type KeyboardEvent } from 'react';
import type { Column, Row } from '@lensiq/shared';
import { canEdit, valueOf } from '../editing/editable';
import type { DatabaseEditing } from '../editing/useDatabaseEditing';
import { Cell } from './cells/Cell';
import { CellEditor } from './editors/CellEditor';

interface Props {
  columns: Column[];
  rows: Row[];
  editing?: DatabaseEditing;
  /** Desktop: click a cell to edit it. Otherwise a tap opens the row panel (Q13). */
  inlineEdit?: boolean;
  onOpenRow?: (rowId: string) => void;
}

/**
 * Table built from the schema. The title column sticks to the left so rows
 * stay identifiable while scrolling sideways on a phone.
 */
export function DatabaseTable({ columns, rows, editing, inlineEdit = false, onOpenRow }: Props) {
  const [active, setActive] = useState<{ rowId: string; columnId: string } | null>(null);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
        No rows to show.
      </p>
    );
  }

  const startEdit = (row: Row, column: Column) => {
    if (!editing || !inlineEdit || !canEdit(column, row.cells[column.id])) return;
    if (column.type === 'checkbox') {
      const v = valueOf(column, row.cells);
      void editing.editCell(row, column, { kind: 'boolean', value: !(v.kind === 'boolean' && v.value) });
      return;
    }
    setActive({ rowId: row.id, columnId: column.id });
  };

  return (
    <div className="overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <table className="min-w-full border-separate border-spacing-0 text-sm" aria-label="Database rows">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th
                key={col.id}
                scope="col"
                className={`sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 ${
                  i === 0 ? 'left-0 z-20' : ''
                }`}
              >
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`group ${!inlineEdit && onOpenRow ? 'cursor-pointer' : ''}`}
              onClick={!inlineEdit && onOpenRow ? () => onOpenRow(row.id) : undefined}
            >
              {columns.map((col, i) => {
                const editable = inlineEdit && !!editing && canEdit(col, row.cells[col.id]);
                const isActive = active?.rowId === row.id && active.columnId === col.id;
                const onKeyDown = (e: KeyboardEvent) => {
                  if (!isActive && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                    e.preventDefault();
                    startEdit(row, col);
                  }
                };
                return (
                  <td
                    key={col.id}
                    tabIndex={editable ? 0 : undefined}
                    aria-label={editable ? `Edit ${col.name}` : undefined}
                    onClick={editable && !isActive ? () => startEdit(row, col) : undefined}
                    onKeyDown={editable ? onKeyDown : undefined}
                    className={`relative border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800 ${
                      editable ? 'cursor-text hover:ring-1 hover:ring-inset hover:ring-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500' : ''
                    } ${
                      i === 0
                        ? 'sticky left-0 z-[5] min-w-40 max-w-64 bg-white font-medium group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800/60'
                        : 'group-hover:bg-slate-50 dark:group-hover:bg-slate-800/60'
                    } ${isActive ? 'z-30' : ''}`}
                  >
                    {i === 0 ? (
                      <span className="flex items-start justify-between gap-2">
                        <Cell value={row.cells[col.id]} column={col} />
                        <span className="flex shrink-0 gap-0.5">
                          {onOpenRow && inlineEdit && (
                            <button
                              type="button"
                              aria-label="Open row"
                              title="Open row"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenRow(row.id);
                              }}
                              className="rounded px-1 text-slate-400 opacity-60 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            >
                              ⤢
                            </button>
                          )}
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open in Notion"
                            title="Open in Notion"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                          >
                            ↗
                          </a>
                        </span>
                      </span>
                    ) : (
                      <Cell value={row.cells[col.id]} column={col} />
                    )}
                    {isActive && editing && (
                      <div className="absolute left-0 top-0 z-30 min-w-full" onClick={(e) => e.stopPropagation()}>
                        <CellEditor
                          column={col}
                          value={valueOf(col, row.cells)}
                          onCommit={(v) => {
                            setActive(null);
                            void editing.editCell(row, col, v);
                          }}
                          onCancel={() => setActive(null)}
                        />
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
