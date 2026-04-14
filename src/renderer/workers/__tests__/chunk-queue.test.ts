// src/renderer/workers/__tests__/chunk-queue.test.ts
import { describe, it, expect } from 'vitest';
import { StreamingChunkQueue } from '../chunk-queue';

describe('StreamingChunkQueue', () => {
  it('should push chunks when not full', () => {
    const queue = new StreamingChunkQueue();
    const result = queue.push({ chatId: 'test', raw: 'data', timestamp: 1 });
    expect(result).toBe(true);
    expect(queue.size()).toBe(1);
  });

  it('should reject chunks when full', () => {
    const queue = new StreamingChunkQueue();
    for (let i = 0; i < 10; i++) {
      queue.push({ chatId: 'test', raw: `data${i}`, timestamp: i });
    }
    const result = queue.push({ chatId: 'test', raw: 'overflow', timestamp: 10 });
    expect(result).toBe(false);
    expect(queue.size()).toBe(10);
  });

  it('should call overflow callback when full', () => {
    const queue = new StreamingChunkQueue();
    let overflowCalled = false;
    queue.onOverflow(() => { overflowCalled = true; });

    for (let i = 0; i < 11; i++) {
      queue.push({ chatId: 'test', raw: `data${i}`, timestamp: i });
    }
    expect(overflowCalled).toBe(true);
  });

  it('should pop batch of chunks', () => {
    const queue = new StreamingChunkQueue();
    for (let i = 0; i < 5; i++) {
      queue.push({ chatId: 'test', raw: `data${i}`, timestamp: i });
    }
    const batch = queue.popBatch(3);
    expect(batch.length).toBe(3);
    expect(queue.size()).toBe(2);
  });
});