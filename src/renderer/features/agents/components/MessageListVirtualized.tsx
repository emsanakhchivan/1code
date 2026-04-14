import { useRef, useEffect } from 'react';
import { usePaginatedMessages } from '../hooks/use-paginated-messages';

interface Props {
  subChatId: string;
}

export function MessageListVirtualized({ subChatId }: Props) {
  const {
    messages,
    isLoading,
    isFetchingMore,
    hasMore,
    fetchMore,
  } = usePaginatedMessages(subChatId);

  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingMore) {
          fetchMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, isFetchingMore, fetchMore]);

  if (isLoading) {
    return <MessagesSkeleton />;
  }

  return (
    <div className="message-list">
      {/* Load more sentinel at top */}
      {hasMore && (
        <div ref={loadMoreRef} className="load-more-sentinel">
          {isFetchingMore ? 'Loading older messages...' : 'Scroll to load more'}
        </div>
      )}

      {/* Messages - TODO: Replace with MessageItem when created */}
      {messages.map((msg, index) => (
        <div key={msg.id || `msg-${index}`} className="message-item" data-role={msg.role}>
          {/* Placeholder rendering - replace with MessageItem component */}
          <div className="message-content">
            {typeof msg.content === 'string'
              ? msg.content
              : msg.parts
                ? msg.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                : JSON.stringify(msg)
            }
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="messages-skeleton">
      {[1, 2, 3].map(i => (
        <div key={i} className="skeleton-message">
          <div className="skeleton-avatar" />
          <div className="skeleton-content" />
        </div>
      ))}
    </div>
  );
}
