// src/renderer/utils/memory-monitor.ts
import { clearAllChunkQueues } from '../workers/chunk-queue';

const MEMORY_CHECK_INTERVAL = 30000; // 30 seconds
const MEMORY_THRESHOLD_MB = 500;
const AGGRESSIVE_THRESHOLD_MB = 800;

export function startMemoryMonitor() {
  const interval = setInterval(() => {
    const heapUsed = process.memoryUsage?.().heapUsed ?? 0;
    const heapMB = heapUsed / (1024 * 1024);

    if (heapMB > AGGRESSIVE_THRESHOLD_MB) {
      console.warn(`Memory critical: ${heapMB.toFixed(0)}MB, triggering aggressive cleanup`);
      triggerAggressiveCleanup();
    } else if (heapMB > MEMORY_THRESHOLD_MB) {
      console.warn(`Memory high: ${heapMB.toFixed(0)}MB, triggering cleanup`);
      triggerCleanup();
    }
  }, MEMORY_CHECK_INTERVAL);

  return () => clearInterval(interval);
}

function triggerCleanup() {
  // Clear chunk queues
  clearAllChunkQueues();

  // Clear stale React Query cache
  // queryClient.removeStaleQueries();
}

function triggerAggressiveCleanup() {
  triggerCleanup();

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  // Clear more caches
  // messageAtomFamily.cleanupStale();
}

export function getMemoryStats() {
  const mem = process.memoryUsage?.() ?? { heapUsed: 0, heapTotal: 0 };
  return {
    heapMB: mem.heapUsed / (1024 * 1024),
    totalMB: mem.heapTotal / (1024 * 1024),
    timestamp: Date.now(),
  };
}