import { useState } from 'react';
import type { View, ViewType } from '@lensiq/shared';
import { timeAgo } from '../format';
import { useDatabaseRows } from '../useDatabaseRows';
import { ViewHost } from '../views/ViewHost';
import { useViewActions, useViews } from '../views/useViews';
import { Popover, fieldClass, smallButton } from './ui';

export { markSynced, resetSyncMemory } from '../useDatabaseRows';

const TYPE_LABEL: Record<ViewType, string> = { table: 'Table', board: 'Board', chart: 'Chart', calendar: 'Calendar' };
const TYPE_ICON: Record<ViewType, string> = { table: '▦', board: '▥', chart: '▁▃▅', calendar: '▤' };

export const viewHref = (dbId: string, viewId: string) => `#/db/${encodeURIComponent(dbId)}/v/${encodeURIComponent(viewId)}`;

/** A database page: header, Notion-style view tabs (Q16), and the selected view. */
export function DatabaseView({ id, viewId }: { id: string; viewId?: string }) {
  const { rows, refresh } = useDatabaseRows(id);
  const views = useViews(id);

  if (rows.isPending) return <p className="p-6 text-slate-500">Loading rows from Notion…</p>;
  if (rows.isError) {
    return (
      <p role="alert" className="m-4 rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
        {rows.error.message}
      </p>
    );
  }

  const { database, rows: data } = rows.data;
  const list = views.data ?? [];
  const active = list.find((v) => v.id === viewId) ?? list[0];

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{database.name}</h2>
          <p className="text-sm text-slate-500" data-testid="sync-status">
            {data.length} {data.length === 1 ? 'row' : 'rows'} · {refresh.isPending ? 'syncing with Notion…' : `synced ${timeAgo(database.lastSyncedAt)}`}
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
      {views.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {views.error.message}
        </p>
      )}
      {list.length > 0 && <ViewTabs dbId={id} views={list} active={active} />}
      {active && <ViewHost key={active.id} view={active} />}
    </section>
  );
}

function ViewTabs({ dbId, views, active }: { dbId: string; views: View[]; active: View | undefined }) {
  const actions = useViewActions(dbId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');

  const add = (type: ViewType) =>
    actions.create.mutate(
      { name: TYPE_LABEL[type], type },
      { onSuccess: (v) => (window.location.hash = viewHref(dbId, v.id)) },
    );

  const commitRename = (v: View) => {
    setRenaming(null);
    const n = name.trim();
    if (n && n !== v.name) actions.update(v.id, { name: n });
  };

  return (
    <nav aria-label="Views" className="flex min-h-12 items-end border-b border-slate-300 dark:border-slate-700">
      {/* Only the tabs scroll sideways; "+ Add view" stays visible at the right (#46). */}
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden">
        {views.map((v, i) => {
          const isActive = v.id === active?.id;
          return (
            <div key={v.id} className={`flex shrink-0 items-center border-b-2 ${isActive ? 'border-slate-900 dark:border-slate-100' : 'border-transparent'}`}>
              {renaming === v.id ? (
                <input
                  aria-label="View name"
                  autoFocus
                  className={`${fieldClass} w-40`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => commitRename(v)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(v);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <a
                  href={viewHref(dbId, v.id)}
                  aria-current={isActive ? 'page' : undefined}
                  onDoubleClick={() => {
                    setRenaming(v.id);
                    setName(v.name);
                  }}
                  className={`flex min-h-11 items-center gap-1.5 px-2 text-sm whitespace-nowrap ${isActive ? 'font-semibold' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
                >
                  <span aria-hidden className="text-xs text-slate-400">
                    {TYPE_ICON[v.type]}
                  </span>
                  {v.name}
                </a>
              )}
              {isActive && renaming !== v.id && (
                <Popover label="⋯" buttonClassName="min-h-9 rounded px-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800" align="left">
                  {(close) => (
                    <div className="flex flex-col items-stretch" aria-label="View actions">
                      <button
                        type="button"
                        className={`${smallButton} text-left`}
                        onClick={() => {
                          close();
                          setRenaming(v.id);
                          setName(v.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={`${smallButton} text-left`}
                        onClick={() => {
                          close();
                          actions.create.mutate(
                            { name: `${v.name} copy`, type: v.type, config: v.config },
                            { onSuccess: (nv) => (window.location.hash = viewHref(dbId, nv.id)) },
                          );
                        }}
                      >
                        Duplicate
                      </button>
                      {i > 0 && (
                        <button type="button" className={`${smallButton} text-left`} onClick={() => (close(), actions.move.mutate({ id: v.id, position: i - 1 }))}>
                          Move left
                        </button>
                      )}
                      {i < views.length - 1 && (
                        <button type="button" className={`${smallButton} text-left`} onClick={() => (close(), actions.move.mutate({ id: v.id, position: i + 1 }))}>
                          Move right
                        </button>
                      )}
                      {views.length > 1 && (
                        <button
                          type="button"
                          className={`${smallButton} text-left text-red-700 dark:text-red-400`}
                          onClick={() => {
                            close();
                            if (window.confirm(`Delete the view “${v.name}”? Your Notion data isn’t affected.`)) {
                              actions.remove.mutate(v.id, { onSuccess: () => (window.location.hash = `#/db/${encodeURIComponent(dbId)}`) });
                            }
                          }}
                        >
                          Delete view
                        </button>
                      )}
                    </div>
                  )}
                </Popover>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex min-h-11 shrink-0 items-center pl-1">
        <Popover
          label="+ Add view"
          buttonClassName="min-h-9 whitespace-nowrap rounded-md border border-dashed border-slate-400 px-3 text-sm font-medium text-slate-700 hover:border-slate-500 hover:bg-white hover:text-slate-900 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:bg-slate-800"
        >
          {(close) => (
            <div className="flex flex-col" aria-label="Add a view">
              {(['table', 'board', 'chart', 'calendar'] as ViewType[]).map((t) => (
                <button key={t} type="button" className="min-h-10 rounded px-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => (close(), add(t))}>
                  <span aria-hidden className="mr-2 text-slate-400">
                    {TYPE_ICON[t]}
                  </span>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </nav>
  );
}
