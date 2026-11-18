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
import { RateLimiter } from './limiter.js';
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
  /** Reads rows edited at or after `sinceIso` (Notion rounds edit times to the minute). */
  fetchChangedRows(dataSourceId: string, sinceIso: string): Promise<StoredRow[]>;
  /** Reads one page as it is in Notion now. */
  fetchRow(pageId: string): Promise<StoredRow>;
  /** Writes properties (keyed by property ID) and returns the updated page. */
  updateRow(pageId: string, properties: Record<string, unknown>): Promise<StoredRow>;
  /** Creates a page in the data source and returns it. */
  createRow(dataSourceId: string, properties: Record<string, unknown>): Promise<StoredRow>;
  /** Moves a page to Notion's trash (restorable in Notion for 30 days). */
  trashRow(pageId: string): Promise<void>;
  /** Page IDs and titles of a (related) data source, for relation columns. */
  fetchTitles(dataSourceId: string): Promise<{ id: string; title: string }[]>;
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
    case APIErrorCode.ValidationError:
      return new AppError(400, 'notion_validation', `Notion rejected the change: ${err.message}`);
    case APIErrorCode.ConflictError:
      return new AppError(503, 'notion_busy', 'Notion was busy saving another change to this page. Try again.');
    default:
      return new AppError(502, 'notion_error', `Notion request failed: ${err.message}`);
  }
}

export class NotionApiSource implements NotionSource {
  private readonly client: InstanceType<typeof Client>;

  constructor(token: string, limiter = new RateLimiter()) {
    // Every HTTP request goes through the limiter (~2.5 req/s). The SDK itself
    // retries 429 and 5xx responses, honoring Retry-After; those retries are
    // also spaced by the limiter because it wraps fetch.
    this.client = new Client({ auth: token, notionVersion: NOTION_VERSION, fetch: limiter.wrapFetch() });
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

  fetchRows(dataSourceId: string): Promise<StoredRow[]> {
    return this.query(dataSourceId);
  }

  fetchChangedRows(dataSourceId: string, sinceIso: string): Promise<StoredRow[]> {
    return this.query(dataSourceId, {
      timestamp: 'last_edited_time',
      last_edited_time: { on_or_after: sinceIso },
    });
  }

  private async query(dataSourceId: string, filter?: object): Promise<StoredRow[]> {
    const rows: StoredRow[] = [];
    try {
      for await (const page of iterateAllDataSourceRows(this.client, {
        data_source_id: dataSourceId,
        page_size: 100,
        ...(filter ? { filter: filter as never } : {}),
      })) {
        if (page.object !== 'page' || !isFullPage(page)) continue;
        if (page.in_trash) continue;
        rows.push(pageToRow(page));
      }
    } catch (err) {
      throw toAppError(err);
    }
    return rows;
  }

  async fetchRow(pageId: string): Promise<StoredRow> {
    try {
      const page = await this.client.pages.retrieve({ page_id: pageId });
      if (!isFullPage(page)) throw new AppError(502, 'notion_partial', 'Notion returned an incomplete page.');
      if (page.in_trash) throw new AppError(410, 'row_trashed', 'That row was deleted in Notion. Refresh to update the list.');
      return pageToRow(page);
    } catch (err) {
      throw rowError(err);
    }
  }

  async updateRow(pageId: string, properties: Record<string, unknown>): Promise<StoredRow> {
    try {
      const page = await this.client.pages.update({ page_id: pageId, properties: properties as never });
      if (!isFullPage(page)) return this.fetchRow(pageId);
      return pageToRow(page);
    } catch (err) {
      throw rowError(err);
    }
  }

  async createRow(dataSourceId: string, properties: Record<string, unknown>): Promise<StoredRow> {
    try {
      const page = await this.client.pages.create({
        parent: { type: 'data_source_id', data_source_id: dataSourceId } as never,
        properties: properties as never,
      });
      if (!isFullPage(page)) return this.fetchRow(page.id);
      return pageToRow(page);
    } catch (err) {
      throw toAppError(err);
    }
  }

  async fetchTitles(dataSourceId: string): Promise<{ id: string; title: string }[]> {
    try {
      return await fetchTitlesWith(this.client, dataSourceId);
    } catch (err) {
      throw toAppError(err);
    }
  }

  async trashRow(pageId: string): Promise<void> {
    try {
      await this.client.pages.update({ page_id: pageId, in_trash: true } as never);
    } catch (err) {
      throw rowError(err);
    }
  }
}

/** Reads only the title property of every page (Notion's `filter_properties`), ~1 request per 100 pages. */
async function fetchTitlesWith(client: InstanceType<typeof Client>, dataSourceId: string): Promise<{ id: string; title: string }[]> {
  const ds = await client.dataSources.retrieve({ data_source_id: dataSourceId });
  const props = ('properties' in ds ? ds.properties : {}) as Record<string, { id: string; type: string }>;
  const titleProp = Object.values(props).find((p) => p.type === 'title');
  const out: { id: string; title: string }[] = [];
  for await (const page of iterateAllDataSourceRows(client, {
    data_source_id: dataSourceId,
    page_size: 100,
    ...(titleProp ? { filter_properties: [titleProp.id] } : {}),
  } as never)) {
    if (page.object !== 'page' || !isFullPage(page) || page.in_trash) continue;
    const t = Object.values(page.properties as Record<string, RawProperty>).find((p) => p.type === 'title');
    out.push({ id: page.id, title: (t ? plainText(t.title) : '') || 'Untitled' });
  }
  return out;
}

/** Page-level errors: a missing page means the row was deleted, not that the database isn't shared. */
function rowError(err: unknown): unknown {
  if (isNotionClientError(err) && err.code === APIErrorCode.ObjectNotFound) {
    return new AppError(410, 'row_gone', 'That row no longer exists in Notion. Refresh to update the list.');
  }
  return toAppError(err);
}

function pageToRow(page: {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: unknown;
}): StoredRow {
  return {
    id: page.id,
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    cells: toCells(page.properties as Record<string, RawProperty>),
  };
}
