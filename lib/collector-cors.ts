export function collectorAllowOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return origin;
  } catch {
    return undefined;
  }
  return undefined;
}

export function collectorCorsHeaders(origin: string | undefined): Record<string, string> {
  const allowed = collectorAllowOrigin(origin);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  };
  if (allowed) {
    headers['access-control-allow-origin'] = allowed;
    headers.vary = 'Origin';
  }
  return headers;
}
