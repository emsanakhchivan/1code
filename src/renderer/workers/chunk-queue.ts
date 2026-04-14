// src/renderer/workers/chunk-queue.ts
export interface Chunk {
  chatId: string;
  raw: string;
  timestamp: number;
}

export class StreamingChunkQueue {
  private queue: Chunk[] = [];
  private maxQueueSize = 10;
  private overflowCallbacks: Set<() => void> = new Set();

  push(chunk: Chunk): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      // Signal backpressure
      this.overflowCallbacks.forEach(cb => cb());
      return false;
    }
    this.queue.push(chunk);
    return true;
  }

  pop(): Chunk | undefined {
    return this.queue.shift();
  }

  popBatch(count: number): Chunk[] {
    const batch: Chunk[] = [];
    while (this.queue.length > 0 && batch.length < count) {
      batch.push(this.queue.shift()!);
    }
    return batch;
  }

  size(): number {
    return this.queue.length;
  }

  isFull(): boolean {
    return this.queue.length >= this.maxQueueSize;
  }

  onOverflow(callback: () => void): void {
    this.overflowCallbacks.add(callback);
  }

  removeOverflowCallback(callback: () => void): void {
    this.overflowCallbacks.delete(callback);
  }

  clear(): void {
    this.queue = [];
    this.overflowCallbacks.clear();
  }
}

// Singleton instance per chat
const chunkQueues = new Map<string, StreamingChunkQueue>();

export const getChunkQueue = (chatId: string): StreamingChunkQueue => {
  if (!chunkQueues.has(chatId)) {
    chunkQueues.set(chatId, new StreamingChunkQueue());
  }
  return chunkQueues.get(chatId)!;
};

export const clearChunkQueue = (chatId: string): void => {
  const queue = chunkQueues.get(chatId);
  if (queue) {
    queue.clear();
    chunkQueues.delete(chatId);
  }
};