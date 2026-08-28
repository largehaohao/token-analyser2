export function isSessionLogFile(name: string): boolean {
  return /\.(jsonl|json|ndjson|log)$/i.test(name.split('/').at(-1) ?? name);
}

export function consumeJsonlChunk(
  pending: string,
  chunk: string,
): { lines: string[]; pending: string } {
  const combined = pending + chunk;
  if (!combined) return { lines: [], pending: '' };
  const complete = /\r?\n$/.test(combined);
  const parts = combined.split(/\r?\n/);
  if (complete) {
    if (parts.at(-1) === '') parts.pop();
    return { lines: parts, pending: '' };
  }
  const nextPending = parts.pop() ?? '';
  return { lines: parts, pending: nextPending };
}
