import type { FastifyInstance } from 'fastify';
import type { AddDatabaseRequest, CreateRowRequest, SyncMode, UpdateCellRequest } from '@lensiq/shared';
import type { Store } from './store.js';
import type { SyncService } from './sync.js';

type DbParams = { Params: { id: string } };
type RowParams = { Params: { id: string; pageId: string } };

/** CellValue is validated in depth by notion/write.ts; here only its outer shape. */
const cellValueSchema = { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } } };

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

  app.get<DbParams>('/api/databases/:id', async (req) => sync.requireDatabase(req.params.id));

  app.get<DbParams & { Querystring: { sync?: SyncMode } }>(
    '/api/databases/:id/rows',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { sync: { type: 'string', enum: ['none', 'changes', 'full'] } },
        },
      },
    },
    async (req) => sync.getRows(req.params.id, req.query.sync ?? 'none'),
  );

  app.post<DbParams>('/api/databases/:id/refresh', async (req) => sync.getRows(req.params.id, 'full'));

  app.post<DbParams & { Body: CreateRowRequest }>(
    '/api/databases/:id/rows',
    {
      schema: {
        body: {
          type: 'object',
          required: ['cells'],
          properties: { cells: { type: 'object', additionalProperties: cellValueSchema } },
        },
      },
    },
    async (req, reply) => reply.code(201).send(await sync.createRow(req.params.id, req.body)),
  );

  app.patch<RowParams & { Body: UpdateCellRequest }>(
    '/api/databases/:id/rows/:pageId',
    {
      schema: {
        body: {
          type: 'object',
          required: ['columnId', 'value', 'expected'],
          properties: {
            columnId: { type: 'string', minLength: 1, maxLength: 200 },
            value: cellValueSchema,
            expected: cellValueSchema,
            force: { type: 'boolean' },
          },
        },
      },
    },
    async (req) => sync.updateCell(req.params.id, req.params.pageId, req.body),
  );

  app.get<DbParams & { Params: { columnId: string } }>('/api/databases/:id/relations/:columnId', async (req) =>
    sync.relationOptions(req.params.id, req.params.columnId),
  );

  /** Redirects to a freshly signed URL for a Notion-hosted file (they expire after about an hour). */
  app.get<{ Params: { id: string; pageId: string; columnId: string; index: string } }>(
    '/api/databases/:id/rows/:pageId/files/:columnId/:index',
    async (req, reply) => {
      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ error: 'bad_request', message: 'Bad file index.' });
      const url = await sync.freshFileUrl(req.params.id, req.params.pageId, req.params.columnId, index);
      return reply.header('Cache-Control', 'no-store').redirect(url, 302);
    },
  );

  app.delete<RowParams>('/api/databases/:id/rows/:pageId', async (req, reply) => {
    await sync.deleteRow(req.params.id, req.params.pageId);
    return reply.code(204).send();
  });
}
