import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CellValue, Column, ConflictResponse, Row, RowsResponse } from '@lensiq/shared';
import { ApiRequestError, api } from '../api';
import { valueOf } from './editable';

export interface Conflict {
  rowId: string;
  column: Column;
  /** What Bob tried to save. */
  mine: CellValue;
  /** What Notion has now. */
  current: CellValue;
}

/**
 * Edits for one database. Every cell edit shows on screen at once
 * (optimistic), then goes to Notion. A rejected edit rolls that cell back and
 * reports the error; a conflict (Q12) puts Notion's value on screen and asks
 * which to keep.
 */
export function useDatabaseEditing(dbId: string) {
  const queryClient = useQueryClient();
  const key = ['rows', dbId];
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  const patchRow = useCallback(
    (rowId: string, update: (row: Row) => Row | null) => {
      queryClient.setQueryData<RowsResponse>(key, (old) => {
        if (!old) return old;
        const rows = old.rows.flatMap((r) => {
          if (r.id !== rowId) return [r];
          const next = update(r);
          return next ? [next] : [];
        });
        return { ...old, rows, database: { ...old.database, rowCount: rows.length } };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, dbId],
  );

  const setCell = (rowId: string, columnId: string, value: CellValue) =>
    patchRow(rowId, (r) => ({ ...r, cells: { ...r.cells, [columnId]: value } }));

  const editCell = useCallback(
    async (row: Row, column: Column, value: CellValue, { force = false, expected }: { force?: boolean; expected?: CellValue } = {}) => {
      const before = expected ?? valueOf(column, row.cells);
      setError(null);
      setPending((n) => n + 1);
      // Stop a background sync from overwriting the optimistic value.
      await queryClient.cancelQueries({ queryKey: key });
      setCell(row.id, column.id, value);
      try {
        const saved = await api.updateCell(dbId, row.id, { columnId: column.id, value, expected: before, force });
        patchRow(row.id, () => saved);
        // A new option (no ID yet) was created in Notion: reload so every picker lists it.
        const named = value.kind === 'select' && value.value ? [value.value] : value.kind === 'multi_select' ? value.value : [];
        if (named.some((o) => !o.id)) void queryClient.invalidateQueries({ queryKey: key });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 409 && (err.body as ConflictResponse)?.error === 'conflict') {
          const body = err.body as ConflictResponse;
          patchRow(row.id, () => body.row);
          setConflict({ rowId: row.id, column, mine: value, current: body.current });
        } else if (err instanceof ApiRequestError && err.status === 410) {
          patchRow(row.id, () => null);
          setError(err.message);
        } else {
          setCell(row.id, column.id, before);
          setError(err instanceof Error ? err.message : 'The change could not be saved.');
        }
      } finally {
        setPending((n) => n - 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dbId, queryClient, patchRow],
  );

  /** Conflict dialog choice: "mine" overwrites Notion; "theirs" keeps Notion's value (already on screen). */
  const resolveConflict = useCallback(
    async (choice: 'mine' | 'theirs') => {
      const c = conflict;
      setConflict(null);
      if (!c || choice === 'theirs') return;
      const data = queryClient.getQueryData<RowsResponse>(key);
      const row = data?.rows.find((r) => r.id === c.rowId);
      if (row) await editCell(row, c.column, c.mine, { force: true, expected: c.current });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conflict, editCell, queryClient, dbId],
  );

  const createRow = useCallback(
    async (cells: Record<string, CellValue>): Promise<Row | null> => {
      setError(null);
      setPending((n) => n + 1);
      try {
        const row = await api.createRow(dbId, { cells });
        queryClient.setQueryData<RowsResponse>(key, (old) =>
          old ? { ...old, rows: [...old.rows, row], database: { ...old.database, rowCount: old.rows.length + 1 } } : old,
        );
        // A new select option may have been created: pick up the new schema.
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: ['databases'] });
        return row;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The row could not be created.');
        return null;
      } finally {
        setPending((n) => n - 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dbId, queryClient],
  );

  const deleteRow = useCallback(
    async (rowId: string): Promise<boolean> => {
      setError(null);
      try {
        await api.deleteRow(dbId, rowId);
        patchRow(rowId, () => null);
        void queryClient.invalidateQueries({ queryKey: ['databases'] });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The row could not be deleted.');
        return false;
      }
    },
    [dbId, patchRow, queryClient],
  );

  return { editCell, conflict, resolveConflict, createRow, deleteRow, error, clearError: () => setError(null), saving: pending > 0 };
}

export type DatabaseEditing = ReturnType<typeof useDatabaseEditing>;
