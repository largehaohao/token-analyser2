import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type { CollectorFs } from './collector-service';

export function createNodeCollectorFs(): CollectorFs {
  return {
    async sessionMetadata(root) {
      const metadata = new Map<string, { title?: string; cwd?: string }>();
      // Companion metadata is optional and read-only; never ingest it as usage.
      const codexRoot = path.basename(root) === '.codex' ? root
        : ['sessions', 'archived_sessions'].includes(path.basename(root)) && path.basename(path.dirname(root)) === '.codex'
          ? path.dirname(root) : undefined;
      if (!codexRoot) return metadata;
      try {
        const index = await fs.readFile(path.join(codexRoot, 'session_index.jsonl'), 'utf8');
        for (const line of index.split('\n')) {
          try {
            const row = JSON.parse(line);
            if (typeof row.id === 'string' && typeof row.thread_name === 'string' && row.thread_name.trim()) {
              metadata.set(row.id, { title: row.thread_name.trim() });
            }
          } catch { /* An incomplete index tail is not a malformed usage event. */ }
        }
      } catch { /* Older Codex versions may not write an index. */ }
      const files = (await fs.readdir(codexRoot)).filter((name) => /^state_\d+\.sqlite$/.test(name))
        .sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]));
      for (const file of files) {
        let db: DatabaseSync | undefined;
        try {
          db = new DatabaseSync(path.join(codexRoot, file), { readOnly: true });
          const columns = new Set((db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>).map((row) => row.name));
          const selected = ['id', 'name', 'agent_nickname', 'title', 'cwd'].filter((column) => columns.has(column));
          if (!columns.has('id')) continue;
          for (const row of db.prepare('SELECT ' + selected.join(', ') + ' FROM threads').all()) {
            const title = [row.name, row.agent_nickname, row.title].find((value) => typeof value === 'string' && value.trim());
            const previous = metadata.get(String(row.id));
            metadata.set(String(row.id), {
              title: typeof title === 'string' ? title.trim() : previous?.title,
              cwd: typeof row.cwd === 'string' ? row.cwd : previous?.cwd,
            });
          }
          break;
        } catch { /* Unknown/locked local schemas fall back to the title index. */ }
        finally { db?.close(); }
      }
      return metadata;
    },
    async realpath(target) {
      try {
        return await fs.realpath(target);
      } catch {
        return path.resolve(target);
      }
    },
    async homeDir() {
      return os.homedir();
    },
    async stat(path) {
      const info = await fs.stat(path);
      return {
        kind: info.isDirectory() ? 'directory' : 'file',
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    },
    async readdir(path) {
      const entries = await fs.readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
      }));
    },
    async read(path, offset) {
      const handle = await fs.open(path, 'r');
      try {
        const info = await handle.stat();
        if (offset >= info.size) return { chunk: '', size: info.size };
        const buffer = Buffer.alloc(info.size - offset);
        await handle.read(buffer, 0, buffer.length, offset);
        return { chunk: buffer.toString('utf8'), size: info.size };
      } finally {
        await handle.close();
      }
    },
  };
}
