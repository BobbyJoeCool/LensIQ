import type { FastifyInstance } from 'fastify';
import type { AddDatabaseRequest } from '@lensiq/shared';
import type { Store } from './store.js';
import type { SyncService } from './sync.js';

export function registerRoutes(app: FastifyInstance, store: Store, sync: SyncService): void {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/databases', async () => store.listDatabases());

  app.post<{ Body: AddDatabaseRequest }>(
    '/api/databases',
    {
      schema: {
        body: {
          type: 'object',
          required: ['idOrUrl'],
          properties: { idOrUrl: { type: 'string', minLength: 1, maxLength: 2000 } },
        },
      },
    },
    async (req, reply) => {
      const db = await sync.addDatabase(req.body.idOrUrl);
      return reply.code(201).send(db);
    },
  );

  app.get<{ Params: { id: string } }>('/api/databases/:id', async (req) => sync.requireDatabase(req.params.id));

  app.get<{ Params: { id: string } }>('/api/databases/:id/rows', async (req) => sync.getRows(req.params.id));

  app.post<{ Params: { id: string } }>('/api/databases/:id/refresh', async (req) =>
    sync.getRows(req.params.id, { refresh: true }),
  );
}
