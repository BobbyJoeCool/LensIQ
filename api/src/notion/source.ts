/**
 * The only module that talks to Notion. Everything else depends on the
 * `NotionSource` interface, so tests (and the Phase 5 demo mode) can swap in a
 * fake without touching the rest of the API.
 */
// @notionhq/client is CommonJS: Node's ESM loader can't see its named exports,
// so import the default and destructure (tsx/vitest hide this; plain node doesn't).
import notionClient from '@notionhq/client';
import type { Schema } from '@lensiq/shared';
import { AppError } from '../errors.js';
import type { StoredRow } from '../store.js';
import { plainText, toCells, toSchema, type RawProperty } from './normalize.js';

const { APIErrorCode, Client, extractNotionId, isFullPage, isNotionClientError, iterateAllDataSourceRows } =
  notionClient;

/** Pinned so a Notion API change can't silently alter responses. */
export const NOTION_VERSION = '2025-09-03';

export interface ResolvedSource {
  dataSourceId: string;
  databaseId: string | null;
}

export interface SourceSnapshot {
  name: string;
  schema: Schema;
}

export interface NotionSource {
  /** Turns a pasted URL, database ID or data source ID into a data source ID. */
  resolve(idOrUrl: string): Promise<ResolvedSource>;
  /** Reads the data source's name and column schema. */
  fetchSchema(dataSourceId: string): Promise<SourceSnapshot>;
  /** Reads every row of the data source. */
  fetchRows(dataSourceId: string): Promise<StoredRow[]>;
}

const NOT_SHARED_HINT =
  'Check the ID, and make sure the database is shared with the LensIQ connection in Notion (··· menu → Connections).';

/** Maps Notion SDK errors to API errors with readable messages. */
export function toAppError(err: unknown): unknown {
  if (!isNotionClientError(err)) return err;
  switch (err.code) {
    case APIErrorCode.ObjectNotFound:
      return new AppError(404, 'notion_not_found', `Notion couldn't find that database. ${NOT_SHARED_HINT}`);
    case APIErrorCode.Unauthorized:
      return new AppError(502, 'notion_unauthorized', 'Notion rejected the integration token. Check NOTION_TOKEN.');
    case APIErrorCode.RestrictedResource:
      return new AppError(403, 'notion_restricted', `The LensIQ connection can't access that database. ${NOT_SHARED_HINT}`);
    case APIErrorCode.RateLimited:
      return new AppError(503, 'notion_rate_limited', 'Notion is rate limiting requests. Try again in a minute.');
    default:
      return new AppError(502, 'notion_error', `Notion request failed: ${err.message}`);
  }
}

export class NotionApiSource implements NotionSource {
  private readonly client: InstanceType<typeof Client>;

  constructor(token: string) {
    // The SDK retries 429 and 529 responses with back-off. The ~2.5 req/s queue
    // for heavier use is Phase 2 (issue #12).
    this.client = new Client({ auth: token, notionVersion: NOTION_VERSION });
  }

  async resolve(idOrUrl: string): Promise<ResolvedSource> {
    const id = extractNotionId(idOrUrl.trim());
    if (!id) {
      throw new AppError(400, 'invalid_id', 'That doesn’t look like a Notion database link or ID.');
    }
    // Try it as a data source ID first, then as a database ID.
    try {
      const ds = await this.client.dataSources.retrieve({ data_source_id: id });
      const databaseId =
        'parent' in ds && ds.parent && 'database_id' in ds.parent ? (ds.parent.database_id as string) : null;
      return { dataSourceId: ds.id, databaseId };
    } catch (err) {
      if (!isNotionClientError(err) || (err.code !== APIErrorCode.ObjectNotFound && err.code !== APIErrorCode.ValidationError)) {
        throw toAppError(err);
      }
    }
    try {
      const db = await this.client.databases.retrieve({ database_id: id });
      const sources = 'data_sources' in db ? db.data_sources : [];
      const first = sources[0];
      if (!first) {
        throw new AppError(422, 'no_data_source', 'That Notion database has no data sources to read.');
      }
      return { dataSourceId: first.id, databaseId: db.id };
    } catch (err) {
      throw toAppError(err);
    }
  }

  async fetchSchema(dataSourceId: string): Promise<SourceSnapshot> {
    try {
      const ds = await this.client.dataSources.retrieve({ data_source_id: dataSourceId });
      if (!('properties' in ds)) {
        throw new AppError(502, 'notion_partial', 'Notion returned an incomplete data source.');
      }
      const name = ('title' in ds ? plainText(ds.title) : '') || 'Untitled';
      return { name, schema: toSchema(ds.properties as unknown as Record<string, RawProperty>) };
    } catch (err) {
      throw toAppError(err);
    }
  }

  async fetchRows(dataSourceId: string): Promise<StoredRow[]> {
    const rows: StoredRow[] = [];
    try {
      for await (const page of iterateAllDataSourceRows(this.client, {
        data_source_id: dataSourceId,
        page_size: 100,
      })) {
        if (page.object !== 'page' || !isFullPage(page)) continue;
        if (page.in_trash) continue;
        rows.push({
          id: page.id,
          url: page.url,
          createdTime: page.created_time,
          lastEditedTime: page.last_edited_time,
          cells: toCells(page.properties as unknown as Record<string, RawProperty>),
        });
      }
    } catch (err) {
      throw toAppError(err);
    }
    return rows;
  }
}
