/**
 * A fake NotionSource for E2E tests. It returns raw, Notion-shaped property
 * data and runs it through the real normalizer, so E2E covers the same code
 * path as production minus the network. All data is fictional.
 */
import { extractNotionId } from '@notionhq/client';
import { AppError } from '../../src/errors.js';
import type { NotionSource, ResolvedSource, SourceSnapshot } from '../../src/notion/source.js';
import { toCells, toSchema, type RawProperty } from '../../src/notion/normalize.js';
import type { StoredRow } from '../../src/store.js';

export const JOB_SEARCH_DB_ID = '1f2e3d4c5b6a47988796a5b4c3d2e1f0';
export const JOB_SEARCH_DS_ID = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';
/** A valid-looking ID the integration "can't see". */
export const UNSHARED_DB_ID = '00000000000000000000000000000bad';

const statusOptions = [
  { id: 's1', name: 'Applied', color: 'blue' },
  { id: 's2', name: 'Interviewing', color: 'yellow' },
  { id: 's3', name: 'Offer', color: 'green' },
  { id: 's4', name: 'Rejected', color: 'red' },
];

const properties: Record<string, RawProperty> = {
  Status: { id: 'stat', name: 'Status', type: 'status', status: { options: statusOptions } },
  Company: { id: 'title', name: 'Company', type: 'title', title: {} },
  Role: { id: 'role', name: 'Role', type: 'rich_text', rich_text: {} },
  Salary: { id: 'sal', name: 'Salary', type: 'number', number: { format: 'dollar' } },
  Applied: { id: 'appl', name: 'Applied', type: 'date', date: {} },
  Remote: { id: 'rem', name: 'Remote', type: 'checkbox', checkbox: {} },
  Posting: { id: 'url', name: 'Posting', type: 'url', url: {} },
  Tags: {
    id: 'tags',
    name: 'Tags',
    type: 'multi_select',
    multi_select: { options: [{ id: 't1', name: 'Frontend', color: 'purple' }, { id: 't2', name: 'Full stack', color: 'pink' }] },
  },
  'Days Since Applied': { id: 'days', name: 'Days Since Applied', type: 'formula', formula: { expression: '' } },
  Contacts: { id: 'rel', name: 'Contacts', type: 'relation', relation: {} },
  Action: { id: 'btn', name: 'Action', type: 'button', button: {} },
};

const text = (s: string) => [{ type: 'text', plain_text: s, text: { content: s } }];

function page(
  id: string,
  created: string,
  v: { company: string; role: string; status: string; salary: number | null; applied: string; remote: boolean; url: string | null; tags: string[]; days: number; contacts: number },
) {
  const opt = statusOptions.find((o) => o.name === v.status)!;
  const props: Record<string, RawProperty> = {
    Company: { id: 'title', type: 'title', title: text(v.company) },
    Role: { id: 'role', type: 'rich_text', rich_text: text(v.role) },
    Status: { id: 'stat', type: 'status', status: opt },
    Salary: { id: 'sal', type: 'number', number: v.salary },
    Applied: { id: 'appl', type: 'date', date: { start: v.applied, end: null, time_zone: null } },
    Remote: { id: 'rem', type: 'checkbox', checkbox: v.remote },
    Posting: { id: 'url', type: 'url', url: v.url },
    Tags: {
      id: 'tags',
      type: 'multi_select',
      multi_select: v.tags.map((t) => (t === 'Frontend' ? { id: 't1', name: t, color: 'purple' } : { id: 't2', name: t, color: 'pink' })),
    },
    'Days Since Applied': { id: 'days', type: 'formula', formula: { type: 'number', number: v.days } },
    Contacts: { id: 'rel', type: 'relation', relation: Array.from({ length: v.contacts }, (_, i) => ({ id: `c${i}` })), has_more: false },
    Action: { id: 'btn', type: 'button', button: {} },
  };
  return { id, url: `https://www.notion.so/${id.replace(/-/g, '')}`, created_time: created, last_edited_time: created, properties: props };
}

const BASE_PAGES = [
  page('p-1', '2026-10-01T15:00:00.000Z', {
    company: 'Northwind Labs', role: 'Senior Frontend Engineer', status: 'Interviewing', salary: 145000,
    applied: '2026-10-01', remote: true, url: 'https://jobs.example.com/northwind', tags: ['Frontend'], days: 47, contacts: 2,
  }),
  page('p-2', '2026-10-12T15:00:00.000Z', {
    company: 'Contoso Analytics', role: 'Full Stack Developer', status: 'Applied', salary: null,
    applied: '2026-10-12', remote: false, url: null, tags: ['Full stack', 'Frontend'], days: 36, contacts: 0,
  }),
];

const LATER_PAGE = page('p-3', '2026-11-15T15:00:00.000Z', {
  company: 'Fabrikam Health', role: 'Software Engineer II', status: 'Applied', salary: 120000,
  applied: '2026-11-15', remote: true, url: 'https://jobs.example.com/fabrikam', tags: [], days: 2, contacts: 1,
});

type RawPage = ReturnType<typeof page> & { in_trash?: boolean };

const clone = <T>(v: T): T => structuredClone(v);

function toStored(p: RawPage): StoredRow {
  return { id: p.id, url: p.url, createdTime: p.created_time, lastEditedTime: p.last_edited_time, cells: toCells(p.properties) };
}

/**
 * An in-memory Notion for E2E. It starts with two Job Search rows, applies
 * writes the way Notion does (including creating new select options), and
 * exposes test hooks that change data "in Notion" behind the app's back:
 * `addLaterRow`, `externalEdit` and `externalDelete`.
 */
export class FixtureNotionSource implements NotionSource {
  private schemaProps = clone(properties);
  private pages: RawPage[] = clone(BASE_PAGES);
  private clock = Date.parse('2026-11-18T12:00:00.000Z');
  private nextId = 100;

  reset(): void {
    this.schemaProps = clone(properties);
    this.pages = clone(BASE_PAGES);
    this.clock = Date.parse('2026-11-18T12:00:00.000Z');
    this.nextId = 100;
  }

  /** Advances the fake clock so each write gets a later last-edited time. */
  private tick(): string {
    this.clock = Math.max(this.clock + 60_000, Date.now());
    return new Date(this.clock).toISOString();
  }

  async resolve(idOrUrl: string): Promise<ResolvedSource> {
    const id = extractNotionId(idOrUrl.trim());
    if (!id) throw new AppError(400, 'invalid_id', 'That doesn’t look like a Notion database link or ID.');
    if (id.replace(/-/g, '') === JOB_SEARCH_DB_ID) return { dataSourceId: JOB_SEARCH_DS_ID, databaseId: JOB_SEARCH_DB_ID };
    throw new AppError(
      404,
      'notion_not_found',
      'Notion couldn\'t find that database. Check the ID, and make sure the database is shared with the LensIQ connection in Notion (··· menu → Connections).',
    );
  }

  async fetchSchema(): Promise<SourceSnapshot> {
    return { name: 'Job Search Tracker', schema: toSchema(this.schemaProps) };
  }

  async fetchRows(): Promise<StoredRow[]> {
    return this.pages.filter((p) => !p.in_trash).map(toStored);
  }

  async fetchChangedRows(_ds: string, sinceIso: string): Promise<StoredRow[]> {
    return this.pages.filter((p) => !p.in_trash && p.last_edited_time >= sinceIso).map(toStored);
  }

  private find(pageId: string): RawPage {
    const p = this.pages.find((x) => x.id === pageId);
    if (!p) throw new AppError(410, 'row_gone', 'That row no longer exists in Notion. Refresh to update the list.');
    if (p.in_trash) throw new AppError(410, 'row_trashed', 'That row was deleted in Notion. Refresh to update the list.');
    return p;
  }

  async fetchRow(pageId: string): Promise<StoredRow> {
    return toStored(this.find(pageId));
  }

  /** Applies a Notion `properties` payload (keyed by property ID) to a page. */
  private apply(p: RawPage, payload: Record<string, unknown>): void {
    for (const [propId, value] of Object.entries(payload)) {
      const schemaEntry = Object.entries(this.schemaProps).find(([, sp]) => sp.id === propId);
      if (!schemaEntry) throw new AppError(400, 'notion_validation', `Notion rejected the change: unknown property ${propId}`);
      const [name, sp] = schemaEntry;
      const v = (value as Record<string, any>)[sp.type];
      const resolveOption = (o: { id?: string; name?: string }) => {
        const options: any[] = sp[sp.type].options;
        let opt = options.find((x) => (o.id ? x.id === o.id : x.name === o.name));
        if (!opt) {
          if (sp.type === 'status' || !o.name) throw new AppError(400, 'notion_validation', 'Notion rejected the change: invalid option');
          opt = { id: `opt-${this.nextId++}`, name: o.name, color: 'default' };
          options.push(opt);
        }
        return { ...opt };
      };
      let raw: unknown = v;
      if (sp.type === 'title' || sp.type === 'rich_text') {
        raw = (v as any[]).map((t) => ({
          type: 'text',
          plain_text: t.text.content,
          text: { content: t.text.content },
          ...(t.annotations ? { annotations: t.annotations } : {}),
        }));
      } else if (sp.type === 'select' || sp.type === 'status') {
        raw = v ? resolveOption(v) : null;
      } else if (sp.type === 'multi_select') {
        raw = (v as any[]).map(resolveOption);
      } else if (sp.type === 'date') {
        raw = v ? { start: v.start, end: v.end ?? null, time_zone: null } : null;
      }
      p.properties[name] = { id: propId, type: sp.type, [sp.type]: raw } as RawProperty;
    }
    p.last_edited_time = this.tick();
  }

  async updateRow(pageId: string, props: Record<string, unknown>): Promise<StoredRow> {
    const p = this.find(pageId);
    this.apply(p, props);
    return toStored(p);
  }

  async createRow(_ds: string, props: Record<string, unknown>): Promise<StoredRow> {
    const created = this.tick();
    const p = page(`p-new-${this.nextId++}`, created, {
      company: '', role: '', status: 'Applied', salary: null, applied: '', remote: false, url: null, tags: [], days: 0, contacts: 0,
    }) as RawPage;
    p.properties.Applied = { id: 'appl', type: 'date', date: null } as RawProperty;
    p.properties['Days Since Applied'] = { id: 'days', type: 'formula', formula: { type: 'number', number: null } } as RawProperty;
    this.apply(p, props);
    p.created_time = created;
    this.pages.push(p);
    return toStored(p);
  }

  async trashRow(pageId: string): Promise<void> {
    this.find(pageId).in_trash = true;
  }

  // ---- Test hooks: changes made "in Notion", outside LensIQ ----

  /** Adds the Fabrikam row, as if someone added it in Notion. */
  addLaterRow(): void {
    if (this.pages.some((p) => p.id === LATER_PAGE.id)) return;
    const p = clone(LATER_PAGE) as RawPage;
    p.last_edited_time = this.tick();
    this.pages.push(p);
  }

  /** Sets a property by name with a raw Notion value payload. */
  externalEdit(pageId: string, propName: string, notionValue: unknown): void {
    const sp = this.schemaProps[propName];
    if (!sp) throw new Error(`No property ${propName}`);
    this.apply(this.find(pageId), { [sp.id]: { [sp.type]: notionValue } });
  }

  externalDelete(pageId: string): void {
    this.find(pageId).in_trash = true;
  }
}
