/**
 * Resilient HTTP client for the Sentinel API.
 *
 * Error-handling contract (see docs/16-error-handling.md):
 *  - Every request has a timeout (AbortController).
 *  - Network failures and 5xx/429 responses are retried with exponential back-off + full jitter.
 *    4xx responses are never retried (they will not succeed on retry).
 *  - Errors from the API arrive as RFC 7807 `application/problem+json` and are surfaced as a
 *    typed `ApiError` carrying the problem's `type`, `title`, `detail` and `traceId`, so the UI
 *    can show a human message while support staff can correlate the trace in the logs.
 */
export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;
  readonly retryable: boolean;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.problem = problem;
    this.retryable = problem.status === 0 || problem.status === 429 || problem.status >= 500;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Full-jitter exponential back-off (AWS Architecture Blog): delay = U(0, min(cap, base·2^attempt)). */
export function backoffDelay(attempt: number, baseMs = 250, capMs = 4000): number {
  return Math.random() * Math.min(capMs, baseMs * 2 ** attempt);
}

async function toProblem(res: Response): Promise<ProblemDetails> {
  const fallback: ProblemDetails = { title: res.statusText || 'Request failed', status: res.status };
  try {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) {
      const body = (await res.json()) as Partial<ProblemDetails>;
      return { ...fallback, ...body, status: body.status ?? res.status };
    }
  } catch {
    /* body was not JSON — keep the fallback */
  }
  return fallback;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, timeoutMs = 8000, retries = 2, signal } = opts;
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
    signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          Accept: 'application/json, application/problem+json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
      }
      lastError = new ApiError(await toProblem(res));
      if (!lastError.retryable) throw lastError;
    } catch (err) {
      if (err instanceof ApiError && !err.retryable) throw err;
      if (signal?.aborted) throw new ApiError({ title: 'Request cancelled', status: 0 });
      lastError =
        err instanceof ApiError
          ? err
          : new ApiError({
              title: err instanceof DOMException && err.name === 'TimeoutError' ? 'Request timed out' : 'Network unavailable',
              status: 0,
              detail: err instanceof Error ? err.message : String(err),
            });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(backoffDelay(attempt));
  }
  throw lastError ?? new ApiError({ title: 'Unknown error', status: 0 });
}

/** Fast health probe used to decide between LIVE and DEMO (offline) mode. */
export async function probeBackend(): Promise<boolean> {
  try {
    await apiFetch<{ status: string }>('/health', { timeoutMs: 1500, retries: 0 });
    return true;
  } catch {
    return false;
  }
}
