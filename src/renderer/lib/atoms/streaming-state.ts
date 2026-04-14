import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

// Tracks which chats are currently streaming (stream-active)
// These chats remain active even when not being viewed
export const streamingChatIdsAtom = atom<Set<string>>(new Set<string>());

// Derived atom to check if a specific chat is streaming
export const isChatStreamingAtom = atomFamily((chatId: string) =>
  atom((get) => get(streamingChatIdsAtom).has(chatId))
);

// Actions to add/remove streaming status
export const addStreamingChatAtom = atom(null, (get, set, chatId: string) => {
  const current = get(streamingChatIdsAtom);
  const updated = new Set(current);
  updated.add(chatId);
  set(streamingChatIdsAtom, updated);
});

export const removeStreamingChatAtom = atom(null, (get, set, chatId: string) => {
  const current = get(streamingChatIdsAtom);
  const updated = new Set(current);
  updated.delete(chatId);
  set(streamingChatIdsAtom, updated);
});