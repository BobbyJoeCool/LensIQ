import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dashboard, DashboardTile, DatabaseSummary, TileHeight, TileSize, View, ViewType } from '@lensiq/shared';
import { api } from '../api';
import { ViewHost } from '../views/ViewHost';
import { useAllViews } from '../views/useViews';
import { viewHref } from './DatabaseView';
import { fieldClass, smallButton } from './ui';

const SPAN: Record<TileSize, string> = {
  small: 'md:col-span-2',
  medium: 'md:col-span-3',
  large: 'md:col-span-4',
  full: 'md:col-span-6',
};
const SIZE_LABEL: Record<TileSize, string> = { small: 'Small (⅓)', medium: 'Medium (½)', large: 'Large (⅔)', full: 'Full width' };
/** Desktop grid rows are 20rem; a standard tile spans two of them (#54). */
const ROWS: Record<TileHeight, string> = { short: 'md:row-span-1', standard: 'md:row-span-2', tall: 'md:row-span-4' };
const HEIGHT_LABEL: Record<TileHeight, string> = { short: 'Short (½)', standard: 'Standard', tall: 'Tall (2×)' };

let seq = 0;
const tileId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * A named page of views from any databases (#24). The grid has six columns
 * on desktop (tiles span a third, half, two thirds or all of it) and rows of
 * a fixed height (tiles are ½, 1 or 2 standard heights, #54); a later tile
 * that fits moves up into a gap. On a phone it stacks to one column and each
 * tile sizes to its content.
 */
export function DashboardPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: ['dashboards', id], queryFn: () => api.getDashboard(id) });
  const views = useAllViews();
  const databases = useQuery({ queryKey: ['databases'], queryFn: api.listDatabases });
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const save = useMutation({
    mutationFn: (patch: { name?: string; tiles?: DashboardTile[] }) => api.updateDashboard(id, patch),
    onMutate: (patch) => {
      queryClient.setQueryData<Dashboard>(['dashboards', id], (d) => (d ? { ...d, ...patch } : d));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDashboard(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      window.location.hash = '#/';
    },
  });

  if (dashboard.isPending) return <p className="p-6 text-slate-500">Loading dashboard…</p>;
  if (dashboard.isError) {
    return (
      <p role="alert" className="m-4 rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
        {dashboard.error.message}
      </p>
    );
  }

  const d = dashboard.data;
  const viewById = new Map((views.data ?? []).map((v) => [v.id, v]));
  const dbName = new Map((databases.data ?? []).map((db) => [db.id, db.name]));
  const setTiles = (tiles: DashboardTile[]) => save.mutate({ tiles });
  const move = (i: number, by: number) => {
    const tiles = [...d.tiles];
    const [t] = tiles.splice(i, 1);
    tiles.splice(Math.max(0, Math.min(tiles.length, i + by)), 0, t!);
    setTiles(tiles);
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <input
            aria-label="Dashboard name"
            autoFocus
            className={`${fieldClass} max-w-sm text-lg`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name.trim() !== d.name) save.mutate({ name: name.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <h2 className="text-xl font-semibold">{d.name}</h2>
        )}
        <div className="flex flex-wrap gap-2">
          {editing && (
            <>
              <button type="button" className={smallButton} onClick={() => (setName(d.name), setRenaming(true))}>
                Rename
              </button>
              <button
                type="button"
                className={`${smallButton} text-red-700 dark:text-red-400`}
                onClick={() => window.confirm(`Delete the dashboard “${d.name}”? Its views stay on their databases.`) && remove.mutate()}
              >
                Delete dashboard
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-pressed={editing}
            className={`min-h-11 rounded-lg px-4 text-sm font-medium ${editing ? 'bg-sky-600 text-white hover:bg-sky-700' : 'border border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'}`}
          >
            {editing ? 'Done' : 'Edit dashboard'}
          </button>
        </div>
      </header>

      {save.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {save.error.message}
        </p>
      )}

      {d.tiles.length === 0 && !editing && (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          <p>This dashboard is empty.</p>
          <button type="button" className="mt-3 min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700" onClick={() => setEditing(true)}>
            Add views
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-flow-row-dense md:auto-rows-[20rem] md:grid-cols-6" aria-label="Dashboard tiles">
        {d.tiles.map((t, i) => {
          const view = viewById.get(t.viewId);
          const height = t.height ?? 'standard';
          return (
            <article
              key={t.id}
              data-height={height}
              className={`flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 md:min-h-0 md:overflow-hidden dark:border-slate-800 dark:bg-slate-900/40 ${SPAN[t.size]} ${ROWS[height]}`}
              aria-label={view?.name ?? 'Missing view'}
            >
              <header className="flex flex-wrap items-center justify-between gap-1">
                {view ? (
                  <a href={viewHref(view.databaseId, view.id)} className="min-w-0 truncate text-sm font-semibold hover:underline" title="Open this view to change its settings">
                    {view.name} <span className="font-normal text-slate-500">· {dbName.get(view.databaseId) ?? 'Database'}</span>
                  </a>
                ) : (
                  <span className="text-sm text-slate-500">This view was deleted.</span>
                )}
                {editing && (
                  <span className="flex items-center gap-1">
                    <select aria-label="Tile size" className={`${fieldClass} min-h-8 w-auto text-xs`} value={t.size} onChange={(e) => setTiles(d.tiles.map((x) => (x.id === t.id ? { ...x, size: e.target.value as TileSize } : x)))}>
                      {(Object.keys(SIZE_LABEL) as TileSize[]).map((s) => (
                        <option key={s} value={s}>
                          {SIZE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <select aria-label="Tile height" className={`${fieldClass} min-h-8 w-auto text-xs`} value={height} onChange={(e) => setTiles(d.tiles.map((x) => (x.id === t.id ? { ...x, height: e.target.value as TileHeight } : x)))}>
                      {(Object.keys(HEIGHT_LABEL) as TileHeight[]).map((h) => (
                        <option key={h} value={h}>
                          {HEIGHT_LABEL[h]}
                        </option>
                      ))}
                    </select>
                    <button type="button" aria-label="Move earlier" className={smallButton} disabled={i === 0} onClick={() => move(i, -1)}>
                      ←
                    </button>
                    <button type="button" aria-label="Move later" className={smallButton} disabled={i === d.tiles.length - 1} onClick={() => move(i, 1)}>
                      →
                    </button>
                    <button type="button" aria-label="Remove tile" className={smallButton} onClick={() => setTiles(d.tiles.filter((x) => x.id !== t.id))}>
                      ×
                    </button>
                  </span>
                )}
              </header>
              {view && <ViewHost view={view} compact />}
            </article>
          );
        })}
      </div>

      {editing && <AddTile views={views.data ?? []} databases={databases.data ?? []} onAdd={(viewId) => setTiles([...d.tiles, { id: tileId(), viewId, size: 'medium', height: 'standard' }])} />}
    </section>
  );
}

/** Adds an existing view, or creates a new view on a database and adds it. */
function AddTile({ views, databases, onAdd }: { views: View[]; databases: DatabaseSummary[]; onAdd: (viewId: string) => void }) {
  const queryClient = useQueryClient();
  const [viewId, setViewId] = useState('');
  const [dbId, setDbId] = useState(databases[0]?.id ?? '');
  const [type, setType] = useState<ViewType>('chart');
  const create = useMutation({
    mutationFn: () => api.createView({ databaseId: dbId, name: type[0]!.toUpperCase() + type.slice(1), type }),
    onSuccess: (v) => {
      void queryClient.invalidateQueries({ queryKey: ['views'] });
      onAdd(v.id);
    },
  });
  const dbName = new Map(databases.map((db) => [db.id, db.name]));

  return (
    <div className="grid gap-4 rounded-xl border border-dashed border-slate-300 p-4 md:grid-cols-2 dark:border-slate-700">
      <form
        className="space-y-2"
        aria-label="Add an existing view"
        onSubmit={(e) => {
          e.preventDefault();
          if (viewId) {
            onAdd(viewId);
            setViewId('');
          }
        }}
      >
        <p className="text-sm font-medium">Add an existing view</p>
        <select aria-label="View to add" className={fieldClass} value={viewId} onChange={(e) => setViewId(e.target.value)}>
          <option value="">Choose a view…</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {dbName.get(v.databaseId) ?? 'Database'} · {v.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!viewId} className="min-h-10 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          Add to dashboard
        </button>
      </form>
      <form
        className="space-y-2"
        aria-label="Create a new view"
        onSubmit={(e) => {
          e.preventDefault();
          if (dbId) create.mutate();
        }}
      >
        <p className="text-sm font-medium">Or make a new one</p>
        <div className="flex gap-2">
          <select aria-label="New view type" className={fieldClass} value={type} onChange={(e) => setType(e.target.value as ViewType)}>
            <option value="chart">Chart</option>
            <option value="board">Board</option>
            <option value="table">Table</option>
            <option value="calendar">Calendar</option>
          </select>
          <select aria-label="Database for the new view" className={fieldClass} value={dbId} onChange={(e) => setDbId(e.target.value)}>
            {databases.map((db) => (
              <option key={db.id} value={db.id}>
                {db.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={!dbId || create.isPending} className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
          Create and add
        </button>
        <p className="text-xs text-slate-500">Set it up afterwards by clicking its title.</p>
        {create.isError && <p className="text-xs text-red-600">{create.error.message}</p>}
      </form>
    </div>
  );
}
