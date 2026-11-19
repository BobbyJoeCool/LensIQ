import { useEffect, useState } from 'react';
import type { CellValue, Column, Row } from '@lensiq/shared';
import { canEdit, isEditableType, valueOf } from '../editing/editable';
import type { DatabaseEditing } from '../editing/useDatabaseEditing';
import { Cell } from './cells/Cell';
import { CellEditor } from './editors/CellEditor';

export type PanelState = { mode: 'edit'; rowId: string } | { mode: 'create'; initial?: Record<string, CellValue> };

interface Props {
  columns: Column[];
  state: PanelState;
  /** The row being edited (edit mode); undefined if it disappeared. */
  row: Row | undefined;
  editing: DatabaseEditing;
  onClose: () => void;
}

/**
 * Side panel with every property of one row (Q13: how rows open on a phone,
 * and from the open icon on desktop). Also the form for a new row.
 */
export function RowPanel({ columns, state, row, editing, onClose }: Props) {
  const creating = state.mode === 'create';
  const [draft, setDraft] = useState<Record<string, CellValue>>(state.mode === 'create' ? (state.initial ?? {}) : {});
  const [active, setActive] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !active) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);

  if (!creating && !row) return null;
  const cells = creating ? draft : row!.cells;
  const titleColumn = columns.find((c) => c.type === 'title');
  const title = titleColumn ? valueOf(titleColumn, cells) : null;
  const titleText = title?.kind === 'text' && title.value ? title.value : creating ? 'New row' : 'Untitled';
  const visible = creating ? columns.filter(isEditableType) : columns;

  const commit = (column: Column, value: CellValue) => {
    setActive(null);
    if (creating) setDraft((d) => ({ ...d, [column.id]: value }));
    else void editing.editCell(row!, column, value);
  };

  const create = async () => {
    setBusy(true);
    const created = await editing.createRow(draft);
    setBusy(false);
    if (created) onClose();
  };

  const remove = async () => {
    setBusy(true);
    const ok = await editing.deleteRow(row!.id);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={creating ? 'New row' : 'Row details'}
        className="flex h-full w-full flex-col bg-white shadow-xl md:w-[28rem] dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="min-w-0 break-words text-lg font-semibold">{titleText}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="min-h-11 min-w-11 shrink-0 rounded-lg text-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ×
          </button>
        </header>

        <dl className="flex-1 space-y-1 overflow-auto p-4">
          {visible.map((column) => {
            const value = valueOf(column, cells);
            const editable = canEdit(column, row?.cells[column.id]);
            return (
              <div key={column.id} className="grid grid-cols-[8rem_1fr] items-start gap-2 py-1">
                <dt className="pt-2.5 text-sm text-slate-500" id={`prop-${column.id}`}>
                  {column.name}
                </dt>
                <dd className="min-w-0">
                  {active === column.id ? (
                    <CellEditor column={column} value={value} onCommit={(v) => commit(column, v)} onCancel={() => setActive(null)} />
                  ) : column.type === 'checkbox' ? (
                    <label className="inline-flex min-h-11 items-center">
                      <input
                        type="checkbox"
                        aria-labelledby={`prop-${column.id}`}
                        className="h-5 w-5 accent-sky-600"
                        checked={value.kind === 'boolean' && value.value}
                        onChange={(e) => commit(column, { kind: 'boolean', value: e.target.checked })}
                      />
                    </label>
                  ) : editable ? (
                    <button
                      type="button"
                      aria-labelledby={`prop-${column.id}`}
                      onClick={() => setActive(column.id)}
                      className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Cell value={value} column={column} />
                    </button>
                  ) : (
                    <div className="flex min-h-11 items-center gap-2 px-2 text-sm">
                      <Cell value={row?.cells[column.id]} column={column} />
                      {value.kind === 'text' && value.rich && (
                        <a href={row?.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-sky-700 underline dark:text-sky-400" title="This text has formatting or links, so it's edited in Notion">
                          Edit in Notion
                        </a>
                      )}
                    </div>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        <footer className="border-t border-slate-200 p-4 dark:border-slate-800">
          {editing.error && (
            <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              {editing.error}
            </p>
          )}
          {creating ? (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void create()} className="min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {busy ? 'Creating…' : 'Create row'}
              </button>
            </div>
          ) : confirmDelete ? (
            <div className="space-y-2">
              <p className="text-sm">Move this row to Notion’s trash? It can be restored in Notion for 30 days.</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                  {busy ? 'Deleting…' : 'Delete row'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">
                Delete
              </button>
              <a href={row!.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">
                Open in Notion ↗
              </a>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}
