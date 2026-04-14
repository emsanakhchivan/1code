// src/renderer/workers/message-parser.worker.ts
import type { Chunk } from './chunk-queue';

/**
 * Marker for individual chunk parse errors.
 * Included in ParseResult.parsed array when JSON.parse fails for a chunk.
 */
export interface ParseErrorMarker {
  parseError: true;
  raw: string;
}

export interface ParseTask {
  chunks: Omit<Chunk, 'timestamp'>[];
  chatId: string;
}

export interface ParseResult {
  chatId: string;
  parsed: (unknown | ParseErrorMarker)[];
  timestamp: number;
}

export interface ParseError {
  chatId: string;
  error: string;
  timestamp: number;
}

// Type for any message from worker
export type WorkerMessage = ParseResult | ParseError;

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