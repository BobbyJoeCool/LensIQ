import fs from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { JWTVerifyGetKey } from 'jose';
import { accessGuard } from './access.js';
import type { AccessConfig } from './config.js';
import { AppError } from './errors.js';
import type { NotionSource } from './notion/source.js';
import { registerRoutes } from './routes.js';
import type { Store } from './store.js';
import { SyncService } from './sync.js';

export interface ServerDeps {
  store: Store;
  notion: NotionSource;
  /** Null disables the Access check (development only; enforced by loadConfig). */
  access: AccessConfig | null;
  /** Override the Access key set (tests). */
  accessKeys?: JWTVerifyGetKey;
  /** Folder with the built React app; skipped if it doesn't exist. */
  webDist?: string;
  logger?: FastifyServerOptions['logger'];
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });

  if (deps.access) app.addHook('onRequest', accessGuard(deps.access, deps.accessKeys));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ ...err.details, error: err.code, message: err.message });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation) {
      return reply.code(400).send({ error: 'bad_request', message: e.message ?? 'Bad request' });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong on the server.' });
  });

  const sync = new SyncService(deps.store, deps.notion);
  registerRoutes(app, deps.store, sync);

  const hasWeb = deps.webDist !== undefined && fs.existsSync(deps.webDist);
  if (hasWeb) {
    app.register(fastifyStatic, { root: deps.webDist!, wildcard: false });
  }

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url === '/api' || req.url.startsWith('/api/');
    if (hasWeb && req.method === 'GET' && !isApi) {
      // Single-page app: unknown paths get the app shell.
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found.' });
  });

  return app;
}
