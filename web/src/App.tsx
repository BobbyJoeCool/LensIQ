import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { AddDatabaseForm } from './components/AddDatabaseForm';
import { DashboardPage } from './components/DashboardPage';
import { DatabaseView, markSynced } from './components/DatabaseView';

type Route =
  | { page: 'home' }
  | { page: 'add' }
  | { page: 'db'; id: string; viewId?: string }
  | { page: 'dash'; id: string };

/** Hash routes: `#/add`, `#/db/<id>`, `#/db/<id>/v/<viewId>` and `#/dash/<id>`. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'add') return { page: 'add' };
  if (parts[0] === 'dash' && parts[1]) return { page: 'dash', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'db' && parts[1]) {
    const route: Route = { page: 'db', id: decodeURIComponent(parts[1]) };
    if (parts[2] === 'v' && parts[3]) route.viewId = decodeURIComponent(parts[3]);
    return route;
  }
  return { page: 'home' };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const navLink = (active: boolean) =>
  `flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap ${
    active
      ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100'
      : 'text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

export function App() {
  const route = useRoute();
  const databases = useQuery({ queryKey: ['databases'], queryFn: api.listDatabases });
  const dashboards = useQuery({ queryKey: ['dashboards'], queryFn: api.listDashboards });
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [dashName, setDashName] = useState('');
  const createDashboard = useMutation({
    mutationFn: (name: string) => api.createDashboard({ name }),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      setNaming(false);
      setDashName('');
      window.location.hash = `#/dash/${encodeURIComponent(d.id)}`;
    },
  });

  // With no databases yet, home is the add form; with some, open the first.
  const list = databases.data ?? [];
  const effective: Route =
    route.page === 'home' && databases.isSuccess
      ? list[0]
        ? { page: 'db', id: list[0].id }
        : { page: 'add' }
      : route;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav
        aria-label="Databases"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:w-60 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:py-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <a href="#/" className="mr-2 flex min-h-11 shrink-0 items-center gap-2 px-2 text-lg font-bold md:mb-3">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          LensIQ
        </a>
        {list.map((db) => (
          <a
            key={db.id}
            href={`#/db/${encodeURIComponent(db.id)}`}
            className={navLink(effective.page === 'db' && effective.id === db.id)}
          >
            {db.name}
          </a>
        ))}
        <a href="#/add" className={navLink(effective.page === 'add')}>
          + Add database
        </a>
        <p className="hidden px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 md:block">Dashboards</p>
        <span className="mx-1 shrink-0 self-center text-slate-300 md:hidden" aria-hidden>
          |
        </span>
        {(dashboards.data ?? []).map((d) => (
          <a key={d.id} href={`#/dash/${encodeURIComponent(d.id)}`} className={navLink(effective.page === 'dash' && effective.id === d.id)}>
            {d.name}
          </a>
        ))}
        {naming ? (
          <form
            className="flex shrink-0 items-center gap-1 px-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (dashName.trim()) createDashboard.mutate(dashName.trim());
            }}
          >
            <input
              aria-label="New dashboard name"
              autoFocus
              placeholder="Dashboard name"
              className="min-h-9 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={dashName}
              onChange={(e) => setDashName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
            />
            <button type="submit" className="min-h-9 rounded-md bg-sky-600 px-2 text-sm font-medium text-white">
              Create
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setNaming(true)} className={navLink(false)}>
            + New dashboard
          </button>
        )}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col overflow-auto p-4 md:p-6">
        {databases.isError && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
            {databases.error.message}
          </p>
        )}
        {databases.isPending && <p className="text-slate-500">Loading…</p>}
        {effective.page === 'add' && (
          <AddDatabaseForm
            onAdded={(db) => {
              markSynced(db.id); // adding just did a full load
              window.location.hash = `#/db/${encodeURIComponent(db.id)}`;
            }}
          />
        )}
        {effective.page === 'db' && <DatabaseView key={effective.id} id={effective.id} viewId={effective.viewId} />}
        {effective.page === 'dash' && <DashboardPage key={effective.id} id={effective.id} />}
      </main>
    </div>
  );
}
