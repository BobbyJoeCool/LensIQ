import { useEffect, useRef, useState } from 'react';
import type { CellChange, CellValue, Column, Row } from '@lensiq/shared';
import { canEdit, isEditableType, valueOf } from '../editing/editable';
import type { DatabaseEditing } from '../editing/useDatabaseEditing';
import { Cell } from './cells/Cell';
import { CellEditor, INVALID, type PendingReader } from './editors/CellEditor';

export type PanelState = { mode: 'edit'; rowId: string } | { mode: 'create'; initial?: Record<string, CellValue> };

interface Props {
  columns: Column[];
  state: PanelState;
  /** The row being edited (edit mode); undefined if it disappeared. */
  row: Row | undefined;
  editing: DatabaseEditing;
  onClose: () => void;
}

const same = (a: CellValue | undefined, b: CellValue | undefined) => JSON.stringify(a ?? { kind: 'empty' }) === JSON.stringify(b ?? { kind: 'empty' });

type Changes = Record<string, { value: CellValue; expected: CellValue }>;

/** Adds one edited value to the panel's changes; changing it back to where it started drops it. */
function withChange(changes: Changes, column: Column, value: CellValue, row: Row): Changes {
  const expected = changes[column.id]?.expected ?? valueOf(column, row.cells);
  const { [column.id]: _drop, ...rest } = changes;
  return same(value, expected) ? rest : { ...rest, [column.id]: { value, expected } };
}

const secondaryButton = 'min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800';
const primaryButton = 'min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50';

/**
 * Side panel with every property of one row (Q13: how rows open on a phone,
 * and from the open icon on desktop). Also the form for a new row.
 *
 * Edits are held in the panel until Save (#57), and properties are locked
 * while a save is in flight so nothing typed then is lost (#61); closing with unsaved edits
 * (×, Cancel, Escape or a tap outside) asks whether to save them. The panel
 * keeps clear of the iPhone status bar and home indicator (safe-area insets),
 * so its buttons can always be tapped.
 */
export function RowPanel({ columns, state, row, editing, onClose }: Props) {
  const creating = state.mode === 'create';
  const initial = state.mode === 'create' ? (state.initial ?? {}) : {};
  const [draft, setDraft] = useState<Record<string, CellValue>>(initial);
  /** Edit mode: changed properties, with the value each one started from (for the conflict check). */
  const [changes, setChanges] = useState<Changes>({});
  /** The open property editor's unsaved input (#60): read before saving or closing so it isn't lost. */
  const pendingRef = useRef<PendingReader | null>(null);
  const [conflicts, setConflicts] = useState<{ columnId: string; current: CellValue }[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDirty = (d: Record<string, CellValue>, c: Changes) => (creating ? JSON.stringify(d) !== JSON.stringify(initial) : Object.keys(c).length > 0);
  const dirty = isDirty(draft, changes);

  /**
   * Folds the open editor's unsaved input into the draft or changes (#60) and
   * closes the editor. Returns the result to use right away (state updates
   * later), or null when the input is invalid and the editor stays open.
   */
  const takePending = (): { draft: Record<string, CellValue>; changes: Changes } | null => {
    const column = active ? columns.find((c) => c.id === active) : undefined;
    const value = column ? pendingRef.current?.() : undefined;
    if (value === INVALID) return null;
    if (!column || value === undefined) return { draft, changes };
    const next = creating ? { draft: { ...draft, [column.id]: value }, changes } : { draft, changes: withChange(changes, column, value, row!) };
    setDraft(next.draft);
    setChanges(next.changes);
    setActive(null);
    return next;
  };

  const requestClose = () => {
    if (busy) return;
    const taken = takePending();
    if (!taken) return;
    if (isDirty(taken.draft, taken.changes)) setConfirmClose(true);
    else onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || active) return;
      if (confirmClose) setConfirmClose(false);
      else requestCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, confirmClose]);

  if (!creating && !row) return null;
  const valueIn = (column: Column): CellValue => {
    if (creating) return valueOf(column, draft);
    return changes[column.id]?.value ?? valueOf(column, row!.cells);
  };
  const cells = creating ? draft : { ...row!.cells, ...Object.fromEntries(Object.entries(changes).map(([id, c]) => [id, c.value])) };
  const titleColumn = columns.find((c) => c.type === 'title');
  const title = titleColumn ? valueOf(titleColumn, cells) : null;
  const titleText = title?.kind === 'text' && title.value ? title.value : creating ? 'New row' : 'Untitled';
  const visible = creating ? columns.filter(isEditableType) : columns;

  const commit = (column: Column, value: CellValue) => {
    if (busy) return; // nothing changes while a save is in flight (#61)
    setActive(null);
    if (creating) setDraft((d) => ({ ...d, [column.id]: value }));
    else setChanges((c) => withChange(c, column, value, row!));
  };

  /** Saves the panel, including an editor that's still open. Returns true when it can close. */
  const save = async (force = false): Promise<boolean> => {
    const taken = takePending();
    if (!taken) return false;
    setBusy(true);
    try {
      if (creating) return !!(await editing.createRow(taken.draft));
      const list: CellChange[] = Object.entries(taken.changes).map(([columnId, c]) => ({ columnId, value: c.value, expected: c.expected }));
      if (!list.length) return true;
      const result = await editing.saveRow(row!, list, { force });
      if (result.ok) {
        setChanges({});
        setConflicts(null);
        return true;
      }
      if (result.conflicts) setConflicts(result.conflicts);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveAndClose = async (force = false) => {
    setConfirmClose(false);
    if (await save(force)) onClose();
  };
  /** Conflict choice "Use Notion's": drop Bob's edits to the properties that changed in Notion. */
  const keepTheirs = () => {
    const ids = new Set(conflicts?.map((c) => c.columnId));
    setChanges((c) => Object.fromEntries(Object.entries(c).filter(([id]) => !ids.has(id))));
    setConflicts(null);
  };

  const remove = async () => {
    setBusy(true);
    const ok = await editing.deleteRow(row!.id);
    setBusy(false);
    if (ok) onClose();
  };

  const conflictNames = (conflicts ?? []).map((c) => columns.find((col) => col.id === c.columnId)?.name ?? 'A property');

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={creating ? 'New row' : 'Row details'}
        className="flex h-full w-full flex-col bg-white pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] shadow-xl md:w-[28rem] dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="min-w-0 break-words text-lg font-semibold">{titleText}</h2>
          <button type="button" aria-label="Close" onClick={requestClose} className="min-h-11 min-w-11 shrink-0 rounded-lg text-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ×
          </button>
        </header>

        <dl className="flex-1 space-y-1 overflow-auto p-4">
          {visible.map((column) => {
            const value = valueIn(column);
            const editable = canEdit(column, row?.cells[column.id]);
            const changed = !creating && !!changes[column.id];
            return (
              <div key={column.id} className="grid grid-cols-[8rem_1fr] items-start gap-2 py-1">
                <dt className="pt-2.5 text-sm text-slate-500" id={`prop-${column.id}`}>
                  {column.name}
                  {changed && (
                    <span className="ml-1 text-sky-600 dark:text-sky-400" title="Changed, not saved yet" aria-label="(changed, not saved yet)">
                      •
                    </span>
                  )}
                </dt>
                <dd className="min-w-0">
                  {active === column.id ? (
                    <CellEditor column={column} value={value} onCommit={(v) => commit(column, v)} onCancel={() => setActive(null)} pendingRef={pendingRef} />
                  ) : column.type === 'checkbox' ? (
                    <label className="inline-flex min-h-11 items-center">
                      <input
                        type="checkbox"
                        aria-labelledby={`prop-${column.id}`}
                        disabled={busy}
                        className="h-5 w-5 accent-sky-600 disabled:opacity-60"
                        checked={value.kind === 'boolean' && value.value}
                        onChange={(e) => commit(column, { kind: 'boolean', value: e.target.checked })}
                      />
                    </label>
                  ) : editable ? (
                    <button
                      type="button"
                      aria-labelledby={`prop-${column.id}`}
                      disabled={busy}
                      onClick={() => setActive(column.id)}
                      className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-slate-800"
                    >
                      <Cell value={value} column={column} rowId={row?.id} />
                    </button>
                  ) : (
                    <div className="flex min-h-11 items-center gap-2 px-2 text-sm">
                      <Cell value={row?.cells[column.id]} column={column} rowId={row?.id} />
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
          {conflicts && (
            <div role="alert" className="mb-3 space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p>
                {conflictNames.map((n) => `“${n}”`).join(', ')} {conflicts.length === 1 ? 'was' : 'were'} changed in Notion since you opened this row. Nothing was saved yet.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={keepTheirs} className={secondaryButton}>
                  Use Notion’s
                </button>
                <button type="button" disabled={busy} onClick={() => void saveAndClose(true)} className={primaryButton}>
                  Keep mine and save
                </button>
              </div>
            </div>
          )}
          {creating ? (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={requestClose} className={secondaryButton}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void saveAndClose()} className={primaryButton}>
                {busy ? 'Creating…' : 'Create row'}
              </button>
            </div>
          ) : confirmDelete ? (
            <div className="space-y-2">
              <p className="text-sm">Move this row to Notion’s trash? It can be restored in Notion for 30 days.</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)} className={secondaryButton}>
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                  {busy ? 'Deleting…' : 'Delete row'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">
                Delete
              </button>
              <a href={row!.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Open in Notion ↗
              </a>
              <span className="ml-auto flex gap-2">
                <button type="button" onClick={requestClose} className={secondaryButton}>
                  Cancel
                </button>
                <button type="button" disabled={busy || (!dirty && !active)} onClick={() => void saveAndClose()} className={primaryButton}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </span>
            </div>
          )}
        </footer>
      </aside>

      {confirmClose && (
        <UnsavedDialog
          creating={creating}
          onSave={() => void saveAndClose()}
          onDiscard={() => {
            setConfirmClose(false);
            onClose();
          }}
          onKeepEditing={() => setConfirmClose(false)}
        />
      )}
    </div>
  );
}

/** Asked when the panel is closed with unsaved edits (#57). */
function UnsavedDialog({ creating, onSave, onDiscard, onKeepEditing }: { creating: boolean; onSave: () => void; onDiscard: () => void; onKeepEditing: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button[data-default]')?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onKeepEditing()}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-desc" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <h2 id="unsaved-title" className="text-lg font-semibold">
          {creating ? 'Save this new row?' : 'Save changes to this row?'}
        </h2>
        <p id="unsaved-desc" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {creating ? 'The new row hasn’t been created yet.' : 'Your changes haven’t been saved to Notion yet.'}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onKeepEditing} className={secondaryButton}>
            Keep editing
          </button>
          <button type="button" onClick={onDiscard} className="min-h-11 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
            Discard
          </button>
          <button type="button" data-default onClick={onSave} className={primaryButton}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
