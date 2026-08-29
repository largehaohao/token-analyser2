import assert from 'node:assert/strict';
import test from 'node:test';
import { collectorAllowOrigin } from '../lib/collector-cors';

test('collector CORS allows loopback dashboard origins and rejects others', () => {
  assert.equal(collectorAllowOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(collectorAllowOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(collectorAllowOrigin('http://[::1]:3000'), 'http://[::1]:3000');
  assert.equal(collectorAllowOrigin('https://example.com'), undefined);
  assert.equal(collectorAllowOrigin('http://evil.local'), undefined);
  assert.equal(collectorAllowOrigin(undefined), undefined);
});
