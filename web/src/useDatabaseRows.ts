import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

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

export const POLL_MS = 60_000;

/**
 * Rows of one database, kept in sync with Notion: the cache first (instant),
 * one full reload per database per app open, then rows edited in Notion every
 * 60 seconds while something on screen shows this database. Several views or
 * dashboard tiles of the same database share one query.
 */
export function useDatabaseRows(id: string, { paused = false }: { paused?: boolean } = {}) {
  const queryClient = useQueryClient();
  const loaded = useRef(false);

  const rows = useQuery({
    queryKey: ['rows', id],
    queryFn: async () => {
      const data = await api.getRows(id, loaded.current ? 'changes' : 'none');
      loaded.current = true;
      return data;
    },
    refetchInterval: paused ? false : POLL_MS,
  });

  const refresh = useMutation({
    mutationFn: () => api.refresh(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['rows', id], data);
      void queryClient.invalidateQueries({ queryKey: ['databases'] });
      void queryClient.invalidateQueries({ queryKey: ['relations', id] }); // a full sync re-reads related titles
    },
  });

  const { mutate: refreshNow } = refresh;
  useEffect(() => {
    if (rows.isSuccess && !fullySynced.has(id)) {
      fullySynced.add(id);
      refreshNow();
    }
  }, [rows.isSuccess, id, refreshNow]);

  return { rows, refresh };
}
