export function GET(): Response {
  return Response.json({
    status: 'ok',
    service: 'tokenscope-local-collector',
    readOnly: true,
    timestamp: new Date().toISOString(),
  });
}
