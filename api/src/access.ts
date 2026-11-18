/**
 * Cloudflare Access check. Cloudflare signs every request that passes Access
 * with a JWT in the `Cf-Access-Jwt-Assertion` header; verifying it means a
 * request that reaches the container without going through Cloudflare (for
 * example from another container on the `web` network) is rejected.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AccessConfig } from './config.js';

export const ACCESS_HEADER = 'cf-access-jwt-assertion';

/** Paths that skip the check: the container health check only. */
const PUBLIC_PATHS = new Set(['/api/health']);

export function remoteKeys(cfg: AccessConfig): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`https://${cfg.teamDomain}/cdn-cgi/access/certs`));
}

/**
 * Returns a Fastify onRequest hook that rejects /api requests without a valid
 * Access JWT. Static files (the React app shell) are not data and are served
 * without it; Cloudflare Access still guards them at the edge.
 */
export function accessGuard(cfg: AccessConfig, keys: JWTVerifyGetKey = remoteKeys(cfg)) {
  const issuer = `https://${cfg.teamDomain}`;
  return async function checkAccess(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const path = req.url.split('?')[0] ?? '';
    if (!(path === '/api' || path.startsWith('/api/')) || PUBLIC_PATHS.has(path)) return;

    const token = req.headers[ACCESS_HEADER];
    if (typeof token !== 'string' || token.length === 0) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Missing Cloudflare Access token.' });
    }
    try {
      await jwtVerify(token, keys, { issuer, audience: cfg.audience });
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'Rejected request with invalid Access token');
      return reply.code(401).send({ error: 'unauthorized', message: 'Invalid Cloudflare Access token.' });
    }
  };
}
