export function GET(): Response {
  return Response.json({
    status: 'ok',
    service: 'tokenscope-dashboard',
    timestamp: new Date().toISOString(),
  });
}
