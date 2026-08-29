import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*', '::ffff:0.0.0.0']);

export interface LoopbackListenTarget {
  address(): AddressInfo | string | null;
  emit(event: string, ...args: unknown[]): boolean;
}

/**
 * Other loopback family for a server that is already listening.
 * Wildcard binds are left alone so the dashboard stays local-only.
 */
export function extraLoopbackHost(addr: { address: string; family?: string | number }): string | undefined {
  const address = addr.address.replace(/^\[|\]$/g, '');
  if (WILDCARD_HOSTS.has(address)) return undefined;
  if (address === '::1') return '127.0.0.1';
  if (address === '127.0.0.1' || address === '::ffff:127.0.0.1') return '::1';
  return undefined;
}

export function attachExtraLoopback(
  primary: LoopbackListenTarget,
  listener: RequestListener,
): Promise<Server | undefined> {
  return new Promise((resolve) => {
    const addr = primary.address();
    if (!addr || typeof addr === 'string') {
      resolve(undefined);
      return;
    }
    const host = extraLoopbackHost(addr);
    if (!host) {
      resolve(undefined);
      return;
    }
    const extra = createServer(listener);
    extra.on('upgrade', (request, socket, head) => {
      primary.emit('upgrade', request, socket, head);
    });
    const onListenError = (error: NodeJS.ErrnoException) => {
      extra.close();
      if (error.code !== 'EADDRINUSE') {
        console.warn('[token-scope] extra loopback bind failed:', error.message);
      }
      resolve(undefined);
    };
    extra.once('error', onListenError);
    extra.listen(addr.port, host, () => {
      extra.off('error', onListenError);
      extra.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE') {
          console.warn('[token-scope] extra loopback bind failed:', error.message);
        }
      });
      resolve(extra);
    });
  });
}
