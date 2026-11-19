import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import type { DatabaseDetail, RowsResponse } from '@lensiq/shared';
import { AppError } from '../src/errors.js';
import type { NotionSource } from '../src/notion/source.js';
import { buildServer } from '../src/server.js';
import { Store, type StoredRow } from '../src/store.js';

const DS = 'ds-1';

function fakeNotion(rows: StoredRow[]): NotionSource & { rowCalls: number } {
  return {
    rowCalls: 0,
    async resolve(idOrUrl) {
      if (idOrUrl === 'missing') throw new AppError(404, 'notion_not_found', 'not shared');
      return { dataSourceId: DS, databaseId: 'db-1' };
    },
    async fetchSchema() {
      return {
        name: 'Job Search',
        schema: { columns: [{ id: 'title', name: 'Company', type: 'title' as const }] },
      };
    },
    async fetchRows() {
      this.rowCalls++;
      return rows;
    },
    async fetchChangedRows() {
      return [];
    },
    async fetchRow() {
      throw new Error('not used');
    },
    async updateRow() {
      throw new Error('not used');
    },
    async createRow() {
      throw new Error('not used');
    },
    async trashRow() {},
  };
}

const row = (id: string, created: string): StoredRow => ({
  id,
  url: `https://notion.so/${id}`,
  createdTime: created,
  lastEditedTime: created,
  cells: { title: { kind: 'text', value: id } },
});

let app: FastifyInstance;
afterEach(async () => app?.close());

describe('database routes (no Access check)', () => {
  it('adds a database, loads rows once, and refreshes on demand', async () => {
    const notion = fakeNotion([row('b', '2026-11-02T00:00:00Z'), row('a', '2026-11-01T00:00:00Z')]);
    app = buildServer({ store: new Store(':memory:'), notion, access: null });

    const add = await app.inject({ method: 'POST', url: '/api/databases', payload: { idOrUrl: 'https://notion.so/x' } });
    expect(add.statusCode).toBe(201);
    expect(add.json<DatabaseDetail>()).toMatchObject({ id: DS, name: 'Job Search', rowCount: 2 });
    expect(notion.rowCalls).toBe(1);

    const rows = await app.inject({ method: 'GET', url: `/api/databases/${DS}/rows` });
    expect(rows.json<RowsResponse>().rows.map((r) => r.id)).toEqual(['a', 'b']); // ordered by created time
    expect(notion.rowCalls).toBe(1); // served from cache

    await app.inject({ method: 'POST', url: `/api/databases/${DS}/refresh` });
    expect(notion.rowCalls).toBe(2);

    const list = await app.inject({ method: 'GET', url: '/api/databases' });
    expect(list.json()).toHaveLength(1);
  });

  it('rejects duplicates, unknown IDs and bad bodies', async () => {
    app = buildServer({ store: new Store(':memory:'), notion: fakeNotion([]), access: null });
    await app.inject({ method: 'POST', url: '/api/databases', payload: { idOrUrl: 'x' } });
    const dup = await app.inject({ method: 'POST', url: '/api/databases', payload: { idOrUrl: 'x' } });
    expect(dup.statusCode).toBe(409);

    const missing = await app.inject({ method: 'POST', url: '/api/databases', payload: { idOrUrl: 'missing' } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'notion_not_found' });

    const bad = await app.inject({ method: 'POST', url: '/api/databases', payload: {} });
    expect(bad.statusCode).toBe(400);

    const nope = await app.inject({ method: 'GET', url: '/api/databases/nope/rows' });
    expect(nope.statusCode).toBe(404);
  });
});

describe('Cloudflare Access check', () => {
  const access = { teamDomain: 'team.cloudflareaccess.com', audience: 'aud-123' };
  let privateKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
    jwks = createLocalJWKSet({ keys: [jwk] });
  });

  const sign = (claims: { iss?: string; aud?: string; exp?: string }) =>
    new SignJWT({ email: 'me@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(claims.iss ?? `https://${access.teamDomain}`)
      .setAudience(claims.aud ?? access.audience)
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? '5m')
      .sign(privateKey);

  const build = () => buildServer({ store: new Store(':memory:'), notion: fakeNotion([]), access, accessKeys: jwks });

  it('rejects API requests without a token, but leaves health open', async () => {
    app = build();
    expect((await app.inject({ url: '/api/databases' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
  });

  it('accepts a valid token', async () => {
    app = build();
    const res = await app.inject({ url: '/api/databases', headers: { 'cf-access-jwt-assertion': await sign({}) } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects the wrong audience, wrong issuer and expired tokens', async () => {
    app = build();
    for (const token of [
      await sign({ aud: 'other' }),
      await sign({ iss: 'https://evil.cloudflareaccess.com' }),
      await sign({ exp: '-1m' }),
    ]) {
      const res = await app.inject({ url: '/api/databases', headers: { 'cf-access-jwt-assertion': token } });
      expect(res.statusCode).toBe(401);
    }
  });
});
