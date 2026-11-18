import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { timeAgo } from '../format';
import { DatabaseTable } from './DatabaseTable';

export function DatabaseView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const rows = useQuery({ queryKey: ['rows', id], queryFn: () => api.getRows(id) });
  const refresh = useMutation({
    mutationFn: () => api.refresh(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['rows', id], data);
      void queryClient.invalidateQueries({ queryKey: ['databases'] });
    },
  });

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
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{database.name}</h2>
          <p className="text-sm text-slate-500" data-testid="sync-status">
            {data.length} {data.length === 1 ? 'row' : 'rows'} · synced {timeAgo(database.lastSyncedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          {refresh.isPending ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      {refresh.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {refresh.error.message}
        </p>
      )}
      <DatabaseTable columns={database.schema.columns} rows={data} />
    </section>
  );
}
