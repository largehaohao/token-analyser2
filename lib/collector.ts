import type { Provider } from './analysis';
import { isSessionLogFile } from './jsonl-cursor';

export interface SourceDocument {
  id: string;
  name: string;
  provider: Provider;
  content: string;
  lastModified?: number;
  relativePath?: string;
  error?: string;
}

export interface FileHandleLike {
  getFile(): Promise<File>;
  name?: string;
}

export interface DirectoryEntryLike {
  kind: 'file' | 'directory';
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<DirectoryEntryLike>;
}

export interface DirectoryHandleLike {
  name?: string;
  values(): AsyncIterable<DirectoryEntryLike>;
}

export function providerFromName(name: string): Provider {
  const value = name.toLowerCase();
  if (value.includes('claude') || value.includes('anthropic')) return 'claude';
  if (value.includes('codex') || value.includes('openai') || value.includes('gpt')) return 'codex';
  return 'unknown';
}

function sourceId(name: string, index: number, lastModified?: number): string {
  return [name, lastModified ?? 0, index].join(':');
}

export async function readFileDocuments(
  files: ArrayLike<File> | Iterable<File>,
  provider?: Provider,
): Promise<SourceDocument[]> {
  const iterable = files as Iterable<File>;
  const list = typeof iterable[Symbol.iterator] === 'function'
    ? Array.from(iterable)
    : Array.from({ length: (files as ArrayLike<File>).length }, (_, index) => (files as ArrayLike<File>)[index]);
  return Promise.all(
    list.map(async (file, index) => {
      const relativePath = file.webkitRelativePath || file.name;
      try {
        return {
          id: sourceId(file.name, index, file.lastModified),
          name: file.name,
          provider: provider ?? providerFromName(file.name),
          content: await file.text(),
          lastModified: file.lastModified,
          relativePath,
        };
      } catch (error) {
        return {
          id: sourceId(file.name, index, file.lastModified),
          name: file.name,
          provider: provider ?? providerFromName(file.name),
          content: '',
          lastModified: file.lastModified,
          relativePath,
          error: error instanceof Error ? error.message : '无法读取文件',
        };
      }
    }),
  );
}

export async function readHandleDocuments(
  handles: Array<{ handle: FileHandleLike; relativePath?: string; provider?: Provider }>,
  previous?: SourceDocument[],
): Promise<SourceDocument[]> {
  const prior = new Map((previous ?? []).map((document) => [document.relativePath ?? document.name, document]));
  return Promise.all(
    handles.map(async ({ handle, relativePath, provider }, index) => {
      const label = relativePath ?? handle.name ?? '未知文件';
      try {
        const file = await handle.getFile();
        const cached = prior.get(relativePath ?? file.name);
        if (cached && cached.lastModified === file.lastModified && cached.error === undefined) {
          return cached;
        }
        return {
          id: sourceId(relativePath ?? file.name, index, file.lastModified),
          name: file.name,
          provider: provider ?? providerFromName(relativePath ?? file.name),
          content: await file.text(),
          lastModified: file.lastModified,
          relativePath: relativePath ?? file.name,
        };
      } catch (error) {
        return {
          id: sourceId(label, index),
          name: handle.name ?? label.split('/').at(-1) ?? label,
          provider: provider ?? providerFromName(label),
          content: '',
          relativePath: label,
          error: error instanceof Error ? error.message : '无法读取文件',
        };
      }
    }),
  );
}

async function walkDirectory(
  directory: DirectoryHandleLike,
  prefix = '',
): Promise<Array<{ handle: FileHandleLike; relativePath: string }>> {
  const result: Array<{ handle: FileHandleLike; relativePath: string }> = [];
  for await (const entry of directory.values()) {
    const relativePath = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.kind === 'file' && entry.getFile && isSessionLogFile(entry.name)) {
      result.push({ handle: entry as FileHandleLike, relativePath });
    } else if (entry.kind === 'directory' && entry.values) {
      result.push(...(await walkDirectory(entry as DirectoryHandleLike, relativePath)));
    }
  }
  return result;
}

export async function chooseDirectoryDocuments(): Promise<{
  directory: DirectoryHandleLike;
  handles: Array<{ handle: FileHandleLike; relativePath: string; provider: Provider }>;
  documents: SourceDocument[];
}> {
  if (typeof window === 'undefined') throw new Error('目录选择只能在浏览器中使用');
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;
  if (!picker) {
    throw new Error('当前浏览器不支持目录实时采集，请改用文件导入');
  }
  const directory = await picker({ mode: 'read' });
  const handles = (await walkDirectory(directory)).map((item) => ({
    ...item,
    provider: providerFromName(item.relativePath),
  }));
  const documents = await readHandleDocuments(handles);
  return { directory, handles, documents };
}

export function startDirectoryWatcher(
  directory: DirectoryHandleLike,
  onUpdate: (documents: SourceDocument[]) => void | Promise<void>,
  intervalMs = 5000,
  onError?: (error: unknown) => void,
): () => void {
  let stopped = false;
  let inFlight = false;
  let previous: SourceDocument[] = [];
  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const handles = (await walkDirectory(directory)).map((item) => ({
        ...item,
        provider: providerFromName(item.relativePath),
      }));
      const documents = await readHandleDocuments(handles, previous);
      previous = documents;
      await onUpdate(documents);
    } catch (error) {
      onError?.(error);
    } finally {
      inFlight = false;
    }
  };
  const timer = window.setInterval(poll, intervalMs);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

export function startHandleWatcher(
  handles: Array<{ handle: FileHandleLike; relativePath?: string; provider?: Provider }>,
  onUpdate: (documents: SourceDocument[]) => void | Promise<void>,
  intervalMs = 5000,
  onError?: (error: unknown) => void,
): () => void {
  let stopped = false;
  let inFlight = false;
  let previous: SourceDocument[] = [];
  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const documents = await readHandleDocuments(handles, previous);
      previous = documents;
      await onUpdate(documents);
    } catch (error) {
      onError?.(error);
    } finally {
      inFlight = false;
    }
  };
  const timer = window.setInterval(poll, intervalMs);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

export function supportsDirectoryPicking(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
