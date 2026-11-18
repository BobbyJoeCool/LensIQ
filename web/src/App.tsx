import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { AddDatabaseForm } from './components/AddDatabaseForm';
import { DatabaseView } from './components/DatabaseView';

type Route = { page: 'home' } | { page: 'add' } | { page: 'db'; id: string };

/** Hash routes: `#/add` and `#/db/<id>`. No router library needed yet. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'add') return { page: 'add' };
  if (parts[0] === 'db' && parts[1]) return { page: 'db', id: decodeURIComponent(parts[1]) };
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
      </nav>

      <main className="flex min-w-0 flex-1 flex-col overflow-auto p-4 md:p-6">
        {databases.isError && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
            {databases.error.message}
          </p>
        )}
        {databases.isPending && <p className="text-slate-500">Loading…</p>}
        {effective.page === 'add' && (
          <AddDatabaseForm onAdded={(db) => (window.location.hash = `#/db/${encodeURIComponent(db.id)}`)} />
        )}
        {effective.page === 'db' && <DatabaseView key={effective.id} id={effective.id} />}
      </main>
    </div>
  );
}
