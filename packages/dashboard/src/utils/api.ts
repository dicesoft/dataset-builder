const BASE_URL = '';

export interface ApiEnvelope<T> {
  version: number;
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const envelope: ApiEnvelope<T> = await res.json();

  if (!envelope.success || !res.ok) {
    const err = envelope.error;
    throw new ApiError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText,
      err?.details
    );
  }

  return envelope.data;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete(path: string): Promise<void> {
  return request<void>(path, { method: 'DELETE' });
}
