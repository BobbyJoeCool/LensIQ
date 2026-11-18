import type { Column, Row } from '@lensiq/shared';
import { Cell } from './cells/Cell';

/**
 * Read-only table built entirely from the schema. The title column sticks to
 * the left so rows stay identifiable while scrolling sideways on a phone.
 * Sorting, filtering and hiding columns come in Phase 3 (TanStack Table).
 */
export function DatabaseTable({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
        This database has no rows yet.
      </p>
    );
  }

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
            <tr key={row.id} className="group">
              {columns.map((col, i) => (
                <td
                  key={col.id}
                  className={`border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800 ${
                    i === 0
                      ? 'sticky left-0 z-[5] min-w-40 max-w-64 bg-white font-medium group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800/60'
                      : 'group-hover:bg-slate-50 dark:group-hover:bg-slate-800/60'
                  }`}
                >
                  {i === 0 ? (
                    <span className="flex items-start justify-between gap-2">
                      <Cell value={row.cells[col.id]} column={col} />
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open in Notion"
                        title="Open in Notion"
                        className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                      >
                        ↗
                      </a>
                    </span>
                  ) : (
                    <Cell value={row.cells[col.id]} column={col} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
