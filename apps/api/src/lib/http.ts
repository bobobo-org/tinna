import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getConnInfo } from '@hono/node-server/conninfo';
import { clientIp } from './rate-limit';

/** 錯誤格式（docs/API.md）：{ error, message, fields? } */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  error: string,
  message: string,
  fields?: Record<string, string>,
) {
  return c.json({ error, message, ...(fields ? { fields } : {}) }, status);
}

export function requestIp(c: Context): string {
  let remote: string | undefined;
  try {
    remote = getConnInfo(c).remote.address;
  } catch {
    remote = undefined; // 測試（app.request）沒有 socket
  }
  return clientIp(c.req.raw.headers, remote);
}

/** 讀 JSON body；不是物件就回 null */
export async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
