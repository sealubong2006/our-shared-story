import type { ApiError as ApiErrorBody } from "@family-album/shared";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@family-album/shared/constants";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Thin fetch wrapper: same-origin cookies, CSRF header, JSON in and out, typed errors. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined && { "Content-Type": "application/json" }),
        ...(method !== "GET" && { [CSRF_HEADER]: CSRF_HEADER_VALUE }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("Can't reach the album right now. Check your connection and try again.", 0);
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody> & T;
  if (!res.ok) {
    throw new ApiError(data.error ?? "Something went wrong. Please try again.", res.status, data.retryAfter);
  }
  return data;
}
