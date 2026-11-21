import type { FastifyInstance } from 'fastify';
import type {
  CreateDashboardRequest,
  CreateViewRequest,
  ExportFile,
  ImportResult,
  UpdateDashboardRequest,
  UpdateViewRequest,
} from '@lensiq/shared';
import { AppError } from './errors.js';
import type { Store } from './store.js';
import { DashboardRepo, ViewRepo, defaultConfig } from './views.js';

type IdParams = { Params: { id: string } };

export function registerViewRoutes(app: FastifyInstance, store: Store): void {
  // Built per use from store.db (not captured once), so the store's database can be swapped (E2E resets).
  const repos = () => ({ views: new ViewRepo(store.db), dashboards: new DashboardRepo(store.db) });

  const requireDatabase = (id: string) => {
    const db = store.getDatabase(id);
    if (!db) throw new AppError(404, 'not_found', 'No connected database with that ID.');
    return db;
  };

  /** Views of one database (creating a default Table view the first time) or of all databases. */
  app.get<{ Querystring: { databaseId?: string } }>('/api/views', async (req) => {
    const { databaseId } = req.query;
    if (!databaseId) return repos().views.list();
    const db = requireDatabase(databaseId);
    const list = repos().views.list(databaseId);
    if (list.length > 0) return list;
    return [repos().views.create({ databaseId, name: 'Table', type: 'table', config: defaultConfig('table', db.schema) })];
  });

  app.get<IdParams>('/api/views/:id', async (req) => repos().views.get(req.params.id));

  app.post<{ Body: CreateViewRequest }>(
    '/api/views',
    {
      schema: {
        body: {
          type: 'object',
          required: ['databaseId', 'name', 'type'],
          properties: {
            databaseId: { type: 'string', minLength: 1 },
            name: { type: 'string' },
            type: { type: 'string', enum: ['table', 'board', 'chart', 'calendar'] },
            config: { type: 'object' },
          },
        },
      },
    },
    async (req, reply) => {
      const db = requireDatabase(req.body.databaseId);
      const view = repos().views.create({
        databaseId: db.id,
        name: req.body.name,
        type: req.body.type,
        config: req.body.config ?? defaultConfig(req.body.type, db.schema),
      });
      return reply.code(201).send(view);
    },
  );

  app.patch<IdParams & { Body: UpdateViewRequest }>(
    '/api/views/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: { name: { type: 'string' }, config: { type: 'object' }, position: { type: 'integer', minimum: 0 } },
        },
      },
    },
    async (req) => repos().views.update(req.params.id, req.body),
  );

  app.delete<IdParams>('/api/views/:id', async (req, reply) => {
    const r = repos();
    r.views.delete(req.params.id, r.dashboards);
    return reply.code(204).send();
  });

  app.get('/api/dashboards', async () => repos().dashboards.list());

  app.get<IdParams>('/api/dashboards/:id', async (req) => repos().dashboards.get(req.params.id));

  app.post<{ Body: CreateDashboardRequest }>(
    '/api/dashboards',
    { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
    async (req, reply) => reply.code(201).send(repos().dashboards.create(req.body.name)),
  );

  app.patch<IdParams & { Body: UpdateDashboardRequest }>(
    '/api/dashboards/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            tiles: {
              type: 'array',
              items: {
                type: 'object',
                required: ['viewId'],
                properties: { id: { type: 'string' }, viewId: { type: 'string' }, size: { type: 'string' }, height: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    async (req) =>
      repos().dashboards.update(req.params.id, req.body, (viewId) => {
        try {
          repos().views.get(viewId);
          return true;
        } catch {
          return false;
        }
      }),
  );

  app.delete<IdParams>('/api/dashboards/:id', async (req, reply) => {
    repos().dashboards.delete(req.params.id);
    return reply.code(204).send();
  });

  /** Every view and dashboard as one JSON file (#38, Q24). Row data stays in Notion. */
  app.get('/api/export', async (_req, reply) => {
    const r = repos();
    const file: ExportFile = { app: 'lensiq', version: 1, exportedAt: new Date().toISOString(), views: r.views.list(), dashboards: r.dashboards.list() };
    return reply.header('Content-Disposition', `attachment; filename="lensiq-views-${file.exportedAt.slice(0, 10)}.json"`).send(file);
  });

  /**
   * Adds the views and dashboards from an export. Views get new IDs; views for
   * databases that aren't connected here are skipped, and so are the tiles
   * that pointed at them. Nothing existing is changed or removed.
   */
  app.post<{ Body: ExportFile }>(
    '/api/import',
    { bodyLimit: 5 * 1024 * 1024, schema: { body: { type: 'object', required: ['app', 'version', 'views', 'dashboards'] } } },
    async (req) => {
      const body = req.body;
      if (body.app !== 'lensiq' || body.version !== 1 || !Array.isArray(body.views) || !Array.isArray(body.dashboards)) {
        throw new AppError(400, 'bad_import', 'That file isn’t a LensIQ export.');
      }
      const r = repos();
      const result: ImportResult = { viewsCreated: 0, dashboardsCreated: 0, viewsSkipped: 0 };
      const idMap = new Map<string, string>();
      store.db.transaction(() => {
        for (const v of [...body.views].sort((a, b) => a.position - b.position)) {
          if (!store.getDatabase(v.databaseId)) {
            result.viewsSkipped++;
            continue;
          }
          const created = r.views.create({ databaseId: v.databaseId, name: v.name, type: v.type, config: v.config });
          idMap.set(v.id, created.id);
          result.viewsCreated++;
        }
        for (const d of body.dashboards) {
          const created = r.dashboards.create(d.name);
          const tiles = (d.tiles ?? []).flatMap((t) => (idMap.has(t.viewId) ? [{ id: '', viewId: idMap.get(t.viewId)!, size: t.size, height: t.height }] : []));
          r.dashboards.update(created.id, { tiles }, (id) => [...idMap.values()].includes(id));
          result.dashboardsCreated++;
        }
      })();
      return result;
    },
  );
}
