export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

import { mockApi } from '../mock';

let csrfToken: string | null = null;
let fetchingCsrf: Promise<string | null> | null = null;

export function setCsrfToken(tok: string | null) {
  csrfToken = tok;
}

export function getCsrfToken() {
  return csrfToken;
}

export async function fetchCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  if (fetchingCsrf) return fetchingCsrf;
  fetchingCsrf = (async () => {
    try {
      const res = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        if (d && typeof d.csrfToken === 'string') {
          csrfToken = d.csrfToken;
          return csrfToken;
        }
      }
    } catch {
      // Ignore network errors on background prefetch
    } finally {
      fetchingCsrf = null;
    }
    return null;
  })();
  return fetchingCsrf;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') return (await mockApi(path, init)) as T;

  const method = (init?.method ?? 'GET').toUpperCase();
  const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  // Lazy CSRF fetch for mutating requests if not yet cached
  if (isMutating && !csrfToken) {
    await fetchCsrfToken();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      credentials: 'include',
      ...init,
      headers,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const message = (b as any)?.error?.message ?? (b as any)?.message ?? 'Something went wrong. Try again.';
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return {} as T;
  }

  const data = await res.json().catch(() => ({}));
  if (data && typeof data === 'object') {
    if ('csrfToken' in data && typeof (data as any).csrfToken === 'string') {
      csrfToken = (data as any).csrfToken;
    }
  }
  return data as T;
}
