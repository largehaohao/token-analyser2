import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { collectorCorsHeaders } from './collector-cors';
import { ensureCollectorPolling, getRuntimeCollector, resetRuntimeCollector, stopCollectorPolling } from './collector-runtime';
import type { AnalysisEvent } from './analysis';

const PORT = Number(process.env.TOKENSCOPE_COLLECTOR_PORT ?? 8787);

function send(response: ServerResponse, status: number, body: unknown, origin?: string) {
  const json = JSON.stringify(body);
  response.writeHead(status, collectorCorsHeaders(origin));
  response.end(json);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function compactEvent(event: AnalysisEvent): AnalysisEvent {
  const rest = { ...event };
  rest.toolInput = rest.toolInput?.slice(0, 320);
  rest.toolOutput = rest.toolOutput?.slice(0, 256);
  return rest.text && rest.text.length > 1200
    ? { ...rest, text: rest.text.slice(0, 1200) + '… [摘录已截断]' }
    : rest;
}

function snapshotPayload() {
  const snapshot = getRuntimeCollector().rawSnapshot();
  return {
    revision: snapshot.revision,
    status: snapshot.status,
    path: snapshot.path,
    message: snapshot.message,
    events: snapshot.events.map(compactEvent),
    errors: snapshot.errors,
    sourceLabel: snapshot.path ? '实时目录 · ' + snapshot.path : undefined,
  };
}

const server = createServer(async (request, response) => {
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  if (request.method === 'OPTIONS') {
    send(response, 204, {}, origin);
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  try {
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      const snapshot = getRuntimeCollector().statusSnapshot();
      send(response, 200, {
        status: 'ok',
        service: 'tokenscope-local-collector',
        readOnly: true,
        collector: snapshot.status,
        path: snapshot.path,
        timestamp: new Date().toISOString(),
      }, origin);
      return;
    }
    if (url.pathname === '/api/collector' || url.pathname === '/') {
      if (request.method === 'GET') {
        const status = getRuntimeCollector().statusSnapshot();
        send(response, 200, url.searchParams.get('since') === status.revision ? status : snapshotPayload(), origin);
        return;
      }
      if (request.method === 'POST') {
        const body = JSON.parse((await readBody(request)) || '{}') as { action?: string; path?: string };
        if (body.action === 'start') {
          if (!body.path?.trim()) {
            send(response, 400, { status: 'error', message: '请输入日志目录路径', events: [], errors: [] }, origin);
            return;
          }
          const collector = resetRuntimeCollector();
          const snapshot = await collector.start(body.path);
          if (snapshot.status === 'collecting') ensureCollectorPolling();
          send(response, 200, snapshotPayload(), origin);
          return;
        }
        if (body.action === 'stop') {
          stopCollectorPolling();
          getRuntimeCollector().stop();
          send(response, 200, snapshotPayload(), origin);
          return;
        }
        if (body.action === 'clear') {
          stopCollectorPolling();
          getRuntimeCollector().clear();
          send(response, 200, snapshotPayload(), origin);
          return;
        }
        send(response, 400, { message: '未知操作' }, origin);
        return;
      }
    }
    send(response, 404, { message: 'not found' }, origin);
  } catch (error) {
    send(response, 500, {
      status: 'error',
      message: error instanceof Error ? error.message : '采集服务出错',
      events: [],
      errors: [],
    }, origin);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('TokenScope 只读采集服务 http://127.0.0.1:' + String(PORT) + '\n');
});
