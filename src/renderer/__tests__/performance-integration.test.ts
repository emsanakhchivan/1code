// src/renderer/__tests__/performance-integration.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamingChunkQueue, clearAllChunkQueues, getChunkQueue } from '../workers/chunk-queue';
import { startMemoryMonitor, getMemoryStats } from '../utils/memory-monitor';

describe('Performance Integration', () => {
  describe('Chunk Queue', () => {
    beforeEach(() => {
      clearAllChunkQueues();
    });

    it('should handle backpressure correctly', () => {
      const queue = new StreamingChunkQueue();
      let overflowCount = 0;
      queue.onOverflow(() => overflowCount++);

      // Fill queue beyond max (10)
      for (let i = 0; i < 15; i++) {
        queue.push({ chatId: 'test', raw: `chunk${i}`, timestamp: i });
      }

      expect(overflowCount).toBeGreaterThan(0);
      expect(queue.size()).toBe(10); // Max size
    });

    it('should pop batches correctly', () => {
      const queue = new StreamingChunkQueue();
      for (let i = 0; i < 7; i++) {
        queue.push({ chatId: 'test', raw: `chunk${i}`, timestamp: i });
      }

      const batch = queue.popBatch(3);
      expect(batch.length).toBe(3);
      expect(queue.size()).toBe(4);
    });

    it('should clear all queues', () => {
      getChunkQueue('chat1').push({ chatId: 'chat1', raw: 'data1', timestamp: 1 });
      getChunkQueue('chat2').push({ chatId: 'chat2', raw: 'data2', timestamp: 2 });

      clearAllChunkQueues();

      // New instances should be empty
      expect(getChunkQueue('chat1').size()).toBe(0);
      expect(getChunkQueue('chat2').size()).toBe(0);
    });
  });

  describe('Memory Monitor', () => {
    it('should return memory stats', () => {
      const stats = getMemoryStats();

      expect(stats).toHaveProperty('heapMB');
      expect(stats).toHaveProperty('totalMB');
      expect(stats).toHaveProperty('timestamp');
      expect(stats.timestamp).toBeGreaterThan(0);
    });

    it('should start and stop monitor', () => {
      const stopMonitor = startMemoryMonitor();

      // Monitor should return a cleanup function
      expect(typeof stopMonitor).toBe('function');

      // Stop the monitor
      stopMonitor();
    });

    it('should return numeric memory values', () => {
      const stats = getMemoryStats();

      expect(typeof stats.heapMB).toBe('number');
      expect(typeof stats.totalMB).toBe('number');
      expect(stats.heapMB).toBeGreaterThanOrEqual(0);
      expect(stats.totalMB).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Memory Monitor and Chunk Queue Integration', () => {
    beforeEach(() => {
      clearAllChunkQueues();
    });

    it('should clear chunk queues during memory cleanup', () => {
      // Create queues with data
      getChunkQueue('test-chat-1').push({ chatId: 'test-chat-1', raw: 'data1', timestamp: 1 });
      getChunkQueue('test-chat-2').push({ chatId: 'test-chat-2', raw: 'data2', timestamp: 2 });

      // Verify queues have data
      expect(getChunkQueue('test-chat-1').size()).toBe(1);
      expect(getChunkQueue('test-chat-2').size()).toBe(1);

      // Clear all queues (simulating memory cleanup)
      clearAllChunkQueues();

      // Verify queues are cleared
      expect(getChunkQueue('test-chat-1').size()).toBe(0);
      expect(getChunkQueue('test-chat-2').size()).toBe(0);
    });

    it('should handle multiple chunk queues per chat', () => {
      const chatIds = ['chat-a', 'chat-b', 'chat-c'];

      // Fill each queue
      chatIds.forEach(chatId => {
        const queue = getChunkQueue(chatId);
        for (let i = 0; i < 5; i++) {
          queue.push({ chatId, raw: `chunk-${i}`, timestamp: i });
        }
      });

      // Verify each has 5 items
      chatIds.forEach(chatId => {
        expect(getChunkQueue(chatId).size()).toBe(5);
      });

      // Clear all
      clearAllChunkQueues();

      // All should be empty
      chatIds.forEach(chatId => {
        expect(getChunkQueue(chatId).size()).toBe(0);
      });
    });
  });
});