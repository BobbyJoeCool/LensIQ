import type {
  AddDatabaseRequest,
  ApiError,
  CreateDashboardRequest,
  CreateRowRequest,
  CreateViewRequest,
  Dashboard,
  UpdateDashboardRequest,
  UpdateViewRequest,
  View,
  DatabaseDetail,
  DatabaseSummary,
  Row,
  RowsResponse,
  SyncMode,
  UpdateCellRequest,
} from '@lensiq/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The parsed JSON error body, when there was one (e.g. a ConflictResponse). */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    // A Cloudflare Access sign-in redirect shows up as a network error here.
    throw new ApiRequestError(0, 'Couldn’t reach LensIQ. If your sign-in expired, reload the page.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let body: unknown;
    try {
      body = await res.json();
      const m = (body as Partial<ApiError>).message;
      if (m) message = m;
    } catch {
      /* not JSON */
    }
    throw new ApiRequestError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const db = (id: string) => `/api/databases/${encodeURIComponent(id)}`;

export const api = {
  listDatabases: () => request<DatabaseSummary[]>('/api/databases'),
  addDatabase: (body: AddDatabaseRequest) =>
    request<DatabaseDetail>('/api/databases', { method: 'POST', body: JSON.stringify(body) }),
  getRows: (id: string, sync: SyncMode = 'none') => request<RowsResponse>(`${db(id)}/rows?sync=${sync}`),
  refresh: (id: string) => request<RowsResponse>(`${db(id)}/refresh`, { method: 'POST' }),
  updateCell: (id: string, pageId: string, body: UpdateCellRequest) =>
    request<Row>(`${db(id)}/rows/${encodeURIComponent(pageId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  createRow: (id: string, body: CreateRowRequest) =>
    request<Row>(`${db(id)}/rows`, { method: 'POST', body: JSON.stringify(body) }),
  deleteRow: (id: string, pageId: string) =>
    request<void>(`${db(id)}/rows/${encodeURIComponent(pageId)}`, { method: 'DELETE' }),

  listViews: (databaseId?: string) =>
    request<View[]>(databaseId ? `/api/views?databaseId=${encodeURIComponent(databaseId)}` : '/api/views'),
  createView: (body: CreateViewRequest) => request<View>('/api/views', { method: 'POST', body: JSON.stringify(body) }),
  updateView: (id: string, body: UpdateViewRequest) =>
    request<View>(`/api/views/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteView: (id: string) => request<void>(`/api/views/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listDashboards: () => request<Dashboard[]>('/api/dashboards'),
  getDashboard: (id: string) => request<Dashboard>(`/api/dashboards/${encodeURIComponent(id)}`),
  createDashboard: (body: CreateDashboardRequest) =>
    request<Dashboard>('/api/dashboards', { method: 'POST', body: JSON.stringify(body) }),
  updateDashboard: (id: string, body: UpdateDashboardRequest) =>
    request<Dashboard>(`/api/dashboards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteDashboard: (id: string) => request<void>(`/api/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
