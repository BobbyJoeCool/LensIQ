/**
 * Test-only server for Playwright: the real Fastify app and built React app,
 * backed by the fixture Notion source and an in-memory SQLite database.
 * Never used in production; not part of the build.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { FixtureNotionSource } from './fixtures/fixtureSource.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT ?? 3100);

let store = new Store(':memory:');
const notion = new FixtureNotionSource();

// Proxy so each reset swaps in a fresh database without rebuilding the server.
const storeProxy = new Proxy({} as Store, {
  get: (_t, prop) => {
    const value = Reflect.get(store, prop);
    return typeof value === 'function' ? value.bind(store) : value;
  },
});

const app = buildServer({
  store: storeProxy,
  notion,
  access: null,
  webDist: path.join(repoRoot, 'web', 'dist'),
});

/** Test hook: wipe all state between tests. */
app.post('/__e2e/reset', async () => {
  store.close();
  store = new Store(':memory:');
  notion.reset();
  return { ok: true };
});

await app.listen({ host: '127.0.0.1', port });
console.log(`E2E server on http://127.0.0.1:${port}`);
