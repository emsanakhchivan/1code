// src/renderer/workers/message-parser.worker.ts
import type { Chunk } from './chunk-queue';

export interface ParseTask {
  chunks: Array<{ chatId: string; raw: string }>;
  chatId: string;
}

export interface ParseResult {
  chatId: string;
  parsed: unknown[];
  timestamp: number;
}

export interface ParseError {
  chatId: string;
  error: string;
  timestamp: number;
}

// Worker receives chunks, parses JSON off main thread
self.onmessage = (event: MessageEvent<ParseTask>) => {
  const { chunks, chatId } = event.data;

  try {
    const parsed = chunks.map(chunk => {
      try {
        return JSON.parse(chunk.raw);
      } catch {
        // Return parse error marker
        return { parseError: true, raw: chunk.raw };
      }
    });

    const result: ParseResult = {
      chatId,
      parsed,
      timestamp: Date.now(),
    };

    self.postMessage(result);
  } catch (error) {
    const errorResult: ParseError = {
      chatId,
      error: String(error),
      timestamp: Date.now(),
    };
    self.postMessage(errorResult);
  }
};

export default {} as typeof Worker;