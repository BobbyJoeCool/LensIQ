import type { AddDatabaseRequest, ApiError, DatabaseDetail, DatabaseSummary, RowsResponse } from '@lensiq/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
    try {
      const body = (await res.json()) as Partial<ApiError>;
      if (body.message) message = body.message;
    } catch {
      /* not JSON */
    }
    throw new ApiRequestError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  listDatabases: () => request<DatabaseSummary[]>('/api/databases'),
  addDatabase: (body: AddDatabaseRequest) =>
    request<DatabaseDetail>('/api/databases', { method: 'POST', body: JSON.stringify(body) }),
  getRows: (id: string) => request<RowsResponse>(`/api/databases/${encodeURIComponent(id)}/rows`),
  refresh: (id: string) => request<RowsResponse>(`/api/databases/${encodeURIComponent(id)}/refresh`, { method: 'POST' }),
};
