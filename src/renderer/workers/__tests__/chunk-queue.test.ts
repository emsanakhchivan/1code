// src/renderer/workers/__tests__/chunk-queue.test.ts
import { describe, it, expect } from 'vitest';
import { StreamingChunkQueue, getChunkQueue, clearChunkQueue } from '../chunk-queue';

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

  it('should pop single chunk', () => {
    const queue = new StreamingChunkQueue();
    queue.push({ chatId: 'test', raw: 'data', timestamp: 1 });
    const chunk = queue.pop();
    expect(chunk).toBeDefined();
    expect(chunk?.raw).toBe('data');
    expect(queue.size()).toBe(0);
  });

  it('should return undefined when popping from empty queue', () => {
    const queue = new StreamingChunkQueue();
    const chunk = queue.pop();
    expect(chunk).toBeUndefined();
  });

  it('should clear queue and overflow callbacks', () => {
    const queue = new StreamingChunkQueue();
    let overflowCalled = false;
    queue.onOverflow(() => { overflowCalled = true; });
    queue.push({ chatId: 'test', raw: 'data', timestamp: 1 });
    queue.clear();
    expect(queue.size()).toBe(0);
    // Overflow callback should be cleared - fill queue and try again
    for (let i = 0; i < 11; i++) {
      queue.push({ chatId: 'test', raw: `data${i}`, timestamp: i });
    }
    expect(overflowCalled).toBe(false); // Callback was cleared
  });

  it('should remove overflow callback', () => {
    const queue = new StreamingChunkQueue();
    let callCount = 0;
    const handler = () => { callCount++; };
    queue.onOverflow(handler);
    // Fill queue to trigger callback
    for (let i = 0; i < 11; i++) {
      queue.push({ chatId: 'test', raw: `data${i}`, timestamp: i });
    }
    expect(callCount).toBe(1);
    // Remove callback, clear, fill again
    queue.removeOverflowCallback(handler);
    queue.clear();
    for (let i = 0; i < 11; i++) {
      queue.push({ chatId: 'test', raw: `data${i}`, timestamp: i });
    }
    expect(callCount).toBe(1); // Not called again
  });

  it('should report isFull correctly', () => {
    const queue = new StreamingChunkQueue();
    expect(queue.isFull()).toBe(false);
    for (let i = 0; i < 10; i++) {
      queue.push({ chatId: 'test', raw: `data${i}`, timestamp: i });
    }
    expect(queue.isFull()).toBe(true);
  });

  it('should pop batch larger than queue size', () => {
    const queue = new StreamingChunkQueue();
    queue.push({ chatId: 'test', raw: 'data1', timestamp: 1 });
    queue.push({ chatId: 'test', raw: 'data2', timestamp: 2 });
    const batch = queue.popBatch(10);
    expect(batch.length).toBe(2);
    expect(queue.size()).toBe(0);
  });
});

describe('Chunk Queue Singleton', () => {
  it('should return same queue for same chatId', () => {
    const queue1 = getChunkQueue('chat-1');
    const queue2 = getChunkQueue('chat-1');
    expect(queue1).toBe(queue2);
  });

  it('should return different queues for different chatIds', () => {
    const queue1 = getChunkQueue('chat-1');
    const queue2 = getChunkQueue('chat-2');
    expect(queue1).not.toBe(queue2);
  });

  it('should clear and delete queue', () => {
    const queue = getChunkQueue('chat-to-clear');
    queue.push({ chatId: 'chat-to-clear', raw: 'data', timestamp: 1 });
    clearChunkQueue('chat-to-clear');
    // New queue should be different instance
    const newQueue = getChunkQueue('chat-to-clear');
    expect(newQueue).not.toBe(queue);
    expect(newQueue.size()).toBe(0);
  });
});