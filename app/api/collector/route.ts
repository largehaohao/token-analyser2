const SIDECAR = 'http://127.0.0.1:8787';

function sidecarHint() {
  return {
    status: 'error',
    message: '本机采集由独立 Node 进程提供，请先运行 npm run collector（默认 ' + SIDECAR + '）。vinext / Cloudflare Workers 无法读取本机日志路径。',
    events: [],
    errors: [],
  };
}

export function GET(): Response {
  return Response.json(sidecarHint(), { status: 503 });
}

export function POST(): Response {
  return Response.json(sidecarHint(), { status: 503 });
}
