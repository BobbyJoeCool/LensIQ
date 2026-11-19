import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { View, ViewConfig, ViewType } from '@lensiq/shared';
import { api } from '../api';

/** Views of one database, in tab order. The API creates a default Table view the first time. */
export function useViews(databaseId: string) {
  return useQuery({ queryKey: ['views', databaseId], queryFn: () => api.listViews(databaseId) });
}

/** Every view of every database (for dashboards). */
export function useAllViews() {
  return useQuery({ queryKey: ['views'], queryFn: () => api.listViews() });
}

const SAVE_DELAY_MS = 400;

/**
 * View changes: settings apply on screen at once and save after a short
 * pause, so typing in a filter doesn't send a request per keystroke.
 */
export function useViewActions(databaseId: string) {
  const queryClient = useQueryClient();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, { name?: string; config?: ViewConfig }>());

  useEffect(() => {
    const t = timers.current;
    return () => {
      // Flush unsaved changes when leaving.
      for (const [id, timer] of t) {
        clearTimeout(timer);
        const body = pending.current.get(id);
        if (body) void api.updateView(id, body);
      }
      t.clear();
    };
  }, []);

  const setLocal = useCallback(
    (id: string, update: (v: View) => View) => {
      const apply = (list: View[] | undefined) => list?.map((v) => (v.id === id ? update(v) : v));
      queryClient.setQueryData<View[]>(['views', databaseId], apply);
      queryClient.setQueryData<View[]>(['views'], apply);
    },
    [databaseId, queryClient],
  );

  const update = useCallback(
    (id: string, patch: { name?: string; config?: ViewConfig }) => {
      setLocal(id, (v) => ({ ...v, ...patch }));
      pending.current.set(id, { ...pending.current.get(id), ...patch });
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          const body = pending.current.get(id);
          pending.current.delete(id);
          if (body) void api.updateView(id, body).catch(() => queryClient.invalidateQueries({ queryKey: ['views'] }));
        }, SAVE_DELAY_MS),
      );
    },
    [queryClient, setLocal],
  );

  const create = useMutation({
    mutationFn: (input: { name: string; type: ViewType; config?: ViewConfig }) => api.createView({ databaseId, ...input }),
    onSuccess: (view) => {
      queryClient.setQueryData<View[]>(['views', databaseId], (list) => [...(list ?? []), view]);
      void queryClient.invalidateQueries({ queryKey: ['views'], exact: true });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteView(id),
    onSuccess: (_r, id) => {
      queryClient.setQueryData<View[]>(['views', databaseId], (list) => list?.filter((v) => v.id !== id));
      void queryClient.invalidateQueries({ queryKey: ['views'], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const move = useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) => api.updateView(id, { position }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['views', databaseId] }),
  });

  return { update, create, remove, move };
}
