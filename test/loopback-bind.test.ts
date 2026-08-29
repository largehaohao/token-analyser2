import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { attachExtraLoopback, extraLoopbackHost } from '../lib/loopback-bind';

test('extraLoopbackHost pairs loopback families and ignores wildcards', () => {
  assert.equal(extraLoopbackHost({ address: '::1', family: 'IPv6' }), '127.0.0.1');
  assert.equal(extraLoopbackHost({ address: '127.0.0.1', family: 'IPv4' }), '::1');
  assert.equal(extraLoopbackHost({ address: '::ffff:127.0.0.1', family: 'IPv6' }), '::1');
  assert.equal(extraLoopbackHost({ address: '0.0.0.0', family: 'IPv4' }), undefined);
  assert.equal(extraLoopbackHost({ address: '::', family: 6 }), undefined);
  assert.equal(extraLoopbackHost({ address: '192.168.1.5', family: 'IPv4' }), undefined);
});

test('attachExtraLoopback serves the other loopback family on the same port', async () => {
  const handler: RequestListener = (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('loopback');
  };
  const primary = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    primary.once('error', reject);
    primary.listen(0, '::1', () => {
      primary.off('error', reject);
      resolve();
    });
  });
  const extra = await attachExtraLoopback(primary, handler);
  try {
    assert.ok(extra);
    const port = (primary.address() as AddressInfo).port;
    const ipv4 = await fetch('http://127.0.0.1:' + String(port));
    const ipv6 = await fetch('http://[::1]:' + String(port));
    assert.equal(ipv4.status, 200);
    assert.equal(await ipv4.text(), 'loopback');
    assert.equal(ipv6.status, 200);
    assert.equal(await ipv6.text(), 'loopback');
  } finally {
    extra?.close();
    await new Promise<void>((resolve) => primary.close(() => resolve()));
  }
});
