import { trpc } from "../../../lib/trpc";

interface PaginatedMessagesResult {
  messages: any[];
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  fetchMore: () => void;
  stats: any;
  total: number;
}

export function usePaginatedMessages(subChatId: string): PaginatedMessagesResult {
  // Initial load with stats (returns the most recent 50 messages)
  const initialQuery = trpc.chats.getInitialMessages.useQuery(
    { subChatId },
    { staleTime: 1000 * 60 * 5 }, // 5 minutes
  );

  // Infinite query for loading older messages (paginated via cursor)
  const infiniteQuery = trpc.chats.getMessagesPaginated.useInfiniteQuery(
    { subChatId, limit: 50 },
    {
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: initialQuery.data?.hasMore ?? false,
      staleTime: 1000 * 60 * 5,
    },
  );

  // Both endpoints return messages in ascending chronological order.
  // getMessagesPaginated: slices [startIndex..startIndex+limit] ascending
  // getInitialMessages: slices last 50 via .slice(-50) ascending
  // Pages arrive in fetch order (page 0 = first 50, page 1 = next 50, etc.)
  // so flatMap gives ascending order naturally.
  const olderMessages =
    infiniteQuery.data?.pages?.flatMap((p) => p.messages) ?? [];
  const recentMessages = initialQuery.data?.messages ?? [];
  const messages = [...olderMessages, ...recentMessages];

  return {
    messages,
    isLoading: initialQuery.isLoading,
    isFetchingMore: infiniteQuery.isFetchingNextPage,
    hasMore: initialQuery.data?.hasMore ?? false,
    fetchMore: () => infiniteQuery.fetchNextPage(),
    stats: initialQuery.data?.stats,
    total: initialQuery.data?.total ?? 0,
  };
}
