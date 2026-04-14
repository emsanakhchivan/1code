// src/renderer/hooks/useMessageParserWorker.ts
import { useCallback, useEffect, useRef } from 'react';

import type {
  ParseError,
  ParseResult,
  ParseTask,
  WorkerMessage,
} from '../workers/message-parser.worker';

export type {
  ParseError,
  ParseErrorMarker,
  ParseResult,
  ParseTask,
} from '../workers/message-parser.worker';

/**
 * React hook for using the message parser web worker.
 *
 * Offloads JSON parsing to a web worker to prevent main thread blocking
 * during streaming message handling.
 *
 * @param onResult - Callback invoked when parsing completes successfully
 * @param onError - Optional callback invoked when a worker error occurs
 * @returns Object with parseChunks function to submit parsing tasks
 *
 * @example
 * ```tsx
 * const { parseChunks } = useMessageParserWorker(
 *   (result) => {
 *     // Process parsed messages, check for parseError markers
 *     result.parsed.forEach(msg => {
 *       if ('parseError' in msg) {
 *         console.warn('Failed to parse:', msg.raw);
 *         return;
 *       }
 *       handleMessage(msg);
 *     });
 *   },
 *   (error) => console.error('Worker error:', error.error)
 * );
 *
 * // Submit chunks for parsing
 * parseChunks({ chunks: [{ chatId: '123', raw: '{"type":"message"}' }], chatId: '123' });
 * ```
 */
export function useMessageParserWorker(
  onResult: (result: ParseResult) => void,
  onError?: (error: ParseError) => void
) {
  const workerRef = useRef<Worker | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  // Keep callback refs updated to avoid stale closures
  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [onResult, onError]);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/message-parser.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if ('error' in event.data) {
        onErrorRef.current?.(event.data);
      } else {
        onResultRef.current(event.data);
      }
    };

    workerRef.current.onerror = (error) => {
      console.error('Worker runtime error:', error);
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const parseChunks = useCallback((task: ParseTask) => {
    workerRef.current?.postMessage(task);
  }, []);

  return { parseChunks };
}