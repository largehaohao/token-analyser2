import { createCollector } from './collector-service';
import { createNodeCollectorFs } from './node-fs';

const globalState = globalThis as typeof globalThis & {
  __tokenscopeCollector?: ReturnType<typeof createCollector>;
  __tokenscopeCollectorTimer?: ReturnType<typeof setInterval>;
  __tokenscopeCollectorPolling?: boolean;
};

export function getRuntimeCollector() {
  globalState.__tokenscopeCollector ??= createCollector(createNodeCollectorFs());
  return globalState.__tokenscopeCollector;
}

export function resetRuntimeCollector() {
  stopCollectorPolling();
  globalState.__tokenscopeCollector = createCollector(createNodeCollectorFs());
  return globalState.__tokenscopeCollector;
}

export function ensureCollectorPolling() {
  if (globalState.__tokenscopeCollectorTimer) return;
  globalState.__tokenscopeCollectorTimer = setInterval(() => {
    if (globalState.__tokenscopeCollectorPolling) return;
    const collector = globalState.__tokenscopeCollector;
    if (!collector) return;
    globalState.__tokenscopeCollectorPolling = true;
    void collector.poll().finally(() => {
      globalState.__tokenscopeCollectorPolling = false;
    });
  }, 5000);
}

export function stopCollectorPolling() {
  if (!globalState.__tokenscopeCollectorTimer) return;
  clearInterval(globalState.__tokenscopeCollectorTimer);
  globalState.__tokenscopeCollectorTimer = undefined;
  globalState.__tokenscopeCollectorPolling = false;
}
