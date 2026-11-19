import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useDatabaseEditing } from '../editing/useDatabaseEditing';
import { timeAgo } from '../format';
import { useIsDesktop } from '../hooks';
import { ConflictDialog } from './ConflictDialog';
import { DatabaseTable } from './DatabaseTable';
import { RowPanel, type PanelState } from './RowPanel';

/** Databases that already had a full load since the app was opened (Q15). */
const fullySynced = new Set<string>();

/** Call after a database's first load (e.g. right after adding it) so opening it doesn't reload again. */
export function markSynced(id: string): void {
  fullySynced.add(id);
}

/** For tests: forget which databases were synced. */
export function resetSyncMemory(): void {
  fullySynced.clear();
}

const POLL_MS = 60_000;

export function DatabaseView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const editing = useDatabaseEditing(id);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const loaded = useRef(false);

  // First read is the cache (instant); every 60 s after that, rows edited in Notion since the last sync.
  const rows = useQuery({
    queryKey: ['rows', id],
    queryFn: async () => {
      const data = await api.getRows(id, loaded.current ? 'changes' : 'none');
      loaded.current = true;
      return data;
    },
    refetchInterval: editing.saving ? false : POLL_MS,
  });

  const refresh = useMutation({
    mutationFn: () => api.refresh(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['rows', id], data);
      void queryClient.invalidateQueries({ queryKey: ['databases'] });
    },
  });

  // Opening a database does a full reload behind the cached rows, so rows deleted in Notion disappear (Q15).
  const { mutate: refreshNow } = refresh;
  useEffect(() => {
    if (rows.isSuccess && !fullySynced.has(id)) {
      fullySynced.add(id);
      refreshNow();
    }
  }, [rows.isSuccess, id, refreshNow]);

  if (rows.isPending) {
    return <p className="p-6 text-slate-500">Loading rows from Notion…</p>;
  }
  if (rows.isError) {
    return (
      <p role="alert" className="m-4 rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
        {rows.error.message}
      </p>
    );
  }

  const { database, rows: data } = rows.data;
  const panelRow = panel?.mode === 'edit' ? data.find((r) => r.id === panel.rowId) : undefined;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{database.name}</h2>
          <p className="text-sm text-slate-500" data-testid="sync-status">
            {data.length} {data.length === 1 ? 'row' : 'rows'} · {refresh.isPending ? 'syncing with Notion…' : `synced ${timeAgo(database.lastSyncedAt)}`}
            {editing.saving && ' · saving…'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPanel({ mode: 'create' })}
            className="min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700"
          >
            + New
          </button>
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            {refresh.isPending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>
      {refresh.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {refresh.error.message}
        </p>
      )}
      {editing.error && !panel && (
        <p role="alert" className="flex items-start justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <span>{editing.error}</span>
          <button type="button" aria-label="Dismiss" onClick={editing.clearError} className="shrink-0 px-1">
            ×
          </button>
        </p>
      )}
      <DatabaseTable
        columns={database.schema.columns}
        rows={data}
        editing={editing}
        inlineEdit={isDesktop}
        onOpenRow={(rowId) => setPanel({ mode: 'edit', rowId })}
      />
      {panel && (
        <RowPanel columns={database.schema.columns} state={panel} row={panelRow} editing={editing} onClose={() => setPanel(null)} />
      )}
      {editing.conflict && <ConflictDialog conflict={editing.conflict} onChoose={(c) => void editing.resolveConflict(c)} />}
    </section>
  );
}
