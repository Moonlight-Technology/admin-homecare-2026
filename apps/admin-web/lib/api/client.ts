/**
 * API client. The access token lives only in this module's memory (never localStorage, spec §10); the refresh
 * token is an HTTP-only cookie the browser sends to /auth/* by itself. Concurrent 401s share one refresh.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export type ErrorEnvelope = { code: string; message: string; details?: unknown; requestId?: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Field messages from a 422 VALIDATION_FAILED response, keyed by field name. */
  get fieldErrors(): Record<string, string[]> {
    const fields = (this.details as { fields?: Record<string, string[]> } | undefined)?.fields;
    return fields ?? {};
  }
}

type TokenResponse = { accessToken: string; expiresIn: number };

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let facilityId: string | null = null;
const sessionListeners = new Set<(signedIn: boolean) => void>();

export const getAccessToken = () => accessToken;

export function setAccessToken(token: string | null) {
  accessToken = token;
  sessionListeners.forEach((listener) => listener(Boolean(token)));
}

/** Notified when the session ends (refresh failed or logout), so the UI can return to login. */
export function onSessionChange(listener: (signedIn: boolean) => void) {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

/** Which of the user's own facilities requests act for; the API checks the membership. */
export const setActiveFacility = (id: string | null) => {
  facilityId = id;
};

async function parseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as Partial<ErrorEnvelope> | null;
  return new ApiError(response.status, body?.code ?? 'HTTP_ERROR', body?.message ?? response.statusText, body?.details, body?.requestId);
}

/** Exchanges the refresh cookie for a new access token; one request at a time. */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as TokenResponse;
      return body.accessToken;
    })
    .catch(() => null)
    .then((token) => {
      setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; query?: Record<string, string | number | boolean | undefined | null> };

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function send(path: string, options: RequestOptions, token: string | null) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (facilityId) headers.set('X-Facility-Id', facilityId);
  return fetch(buildUrl(path, options.query), {
    ...options,
    headers,
    credentials: path.startsWith('/auth/') ? 'include' : 'omit',
    body: options.body === undefined ? undefined : options.body instanceof FormData ? options.body : JSON.stringify(options.body),
  });
}

/** Authenticated request; refreshes once on 401 and retries. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options, accessToken ?? (await refreshAccessToken()));
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const token = await refreshAccessToken();
    if (token) response = await send(path, options, token);
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function login(email: string, password: string) {
  const response = await send('/auth/login', { method: 'POST', body: { email, password } }, null);
  if (!response.ok) throw await parseError(response);
  setAccessToken(((await response.json()) as TokenResponse).accessToken);
}

export async function logout() {
  await send('/auth/logout', { method: 'POST' }, null).catch(() => undefined);
  setAccessToken(null);
}

/** Public auth endpoints that need no session. */
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const response = await send(path, { method: 'POST', body }, null);
  if (!response.ok) throw await parseError(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
