// src/renderer/hooks/useMessageParserWorker.ts
import { useCallback, useEffect, useRef } from 'react';

import type {
  ParseResult,
  ParseTask,
} from '../workers/message-parser.worker';

export type { ParseResult, ParseTask } from '../workers/message-parser.worker';

/**
 * React hook for using the message parser web worker.
 *
 * Offloads JSON parsing to a web worker to prevent main thread blocking
 * during streaming message handling.
 *
 * @param onResult - Callback invoked when parsing completes
 * @returns Object with parseChunks function to submit parsing tasks
 *
 * @example
 * ```tsx
 * const { parseChunks } = useMessageParserWorker((result) => {
 *   if ('error' in result) {
 *     console.error('Parse error:', result.error);
 *     return;
 *   }
 *   // Process parsed messages
 *   result.parsed.forEach(msg => handleMessage(msg));
 * });
 *
 * // Submit chunks for parsing
 * parseChunks({ chunks: [{ chatId: '123', raw: '{"type":"message"}' }], chatId: '123' });
 * ```
 */
export function useMessageParserWorker(
  onResult: (result: ParseResult) => void
) {
  const workerRef = useRef<Worker | null>(null);
  const onResultRef = useRef(onResult);

  // Keep callback ref updated to avoid stale closures
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/message-parser.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (event: MessageEvent<ParseResult>) => {
      onResultRef.current(event.data);
    };

    workerRef.current.onerror = (error) => {
      console.error('Worker error:', error);
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