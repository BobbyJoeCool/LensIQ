import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Column } from '@lensiq/shared';
import { api } from './api';

/** Which database the cells on screen belong to (for relation titles and fresh file links). */
export const CellContext = createContext<{ dbId: string } | null>(null);

export const useCellContext = () => useContext(CellContext);

/** Titles of a relation column's target pages (Q20). Shared by every cell of that column. */
export function useRelationOptions(column: Column) {
  const ctx = useCellContext();
  return useQuery({
    queryKey: ['relations', ctx?.dbId, column.id],
    queryFn: () => api.relationOptions(ctx!.dbId, column.id),
    enabled: !!ctx && column.type === 'relation',
    staleTime: 5 * 60_000,
  });
}
