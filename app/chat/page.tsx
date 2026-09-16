'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChatInterface, type Message } from '@/components/chat/ChatInterface';
import {
  ConversationSidebar,
  type ConversationSummary,
} from '@/components/chat/ConversationSidebar';

interface ConversationDetail {
  conversation: ConversationSummary;
  messages: {
    id: string;
    question: string;
    answer: string;
    sources: { title: string; similarity: number }[];
    stat_data?: unknown;
    created_at: string;
  }[];
}

/** 把后端消息记录映射为聊天界面的 Message[]（问题/回答交叉，按时间正序） */
function toMessages(records: ConversationDetail['messages']): Message[] {
  const result: Message[] = [];
  for (const r of records) {
    result.push({ role: 'user', content: r.question });
    result.push({
      role: 'assistant',
      content: r.answer,
      sources: r.sources && r.sources.length > 0 ? r.sources : undefined,
      statData: (r.stat_data as Message['statData']) || undefined,
    });
  }
  return result;
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshConversations = useCallback(async (): Promise<ConversationSummary[]> => {
    const res = await fetch('/api/conversations');
    if (!res.ok) throw new Error('获取会话列表失败');
    const data = await res.json();
    const list: ConversationSummary[] = data.conversations || [];
    setConversations(list);
    return list;
  }, []);

  /** 加载会话详情（消息），失败抛出 */
  const loadConversation = useCallback(async (id: string): Promise<void> => {
    setLoadingMessages(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) throw new Error('获取会话详情失败');
      const data: ConversationDetail = await res.json();
      setMessages(toMessages(data.messages));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载会话失败');
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  /** 初始化：加载会话列表，默认选中最近会话 */
  useEffect(() => {
    (async () => {
      try {
        const list = await refreshConversations();
        if (list.length > 0) {
          setActiveId(list[0].id);
          await loadConversation(list[0].id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '初始化失败');
      } finally {
        setLoadingList(false);
      }
    })();
  }, [refreshConversations, loadConversation]);

  /** 新建会话 */
  const handleCreate = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('新建会话失败');
      const data = await res.json();
      const conv: ConversationSummary = data.conversation;
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      setMessages([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '新建会话失败');
    }
  }, []);

  /** 切换会话 */
  const handleSelect = useCallback(
    async (id: string) => {
      if (id === activeId) return;
      setActiveId(id);
      await loadConversation(id);
    },
    [activeId, loadConversation]
  );

  /** 删除会话 */
  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除会话失败');
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (id === activeId) {
        if (remaining.length > 0) {
          setActiveId(remaining[0].id);
          await loadConversation(remaining[0].id);
        } else {
          setActiveId(null);
          setMessages([]);
        }
      }
    },
    [conversations, activeId, loadConversation]
  );

  /** 重命名会话 */
  const handleRename = useCallback(
    async (id: string, title: string) => {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('重命名失败');
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
    },
    []
  );

  /** 消息变化：更新消息，并把活跃会话移到列表最前（最新对话优先） */
  const handleMessagesChange = useCallback(
    (msgs: Message[]) => {
      const hasNew = msgs.length > messages.length;
      setMessages(msgs);
      if (hasNew && activeId) {
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === activeId);
          if (idx < 0) return prev;
          const item = {
            ...prev[idx],
            message_count: prev[idx].message_count + 1,
          };
          return [item, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
        });
      }
    },
    [messages.length, activeId]
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        loading={loadingList}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={handleRename}
      />
      <div className="flex-1 min-w-0 relative">
        {/* 会话标题栏 */}
        <div className="border-b border-border bg-surface px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-sm font-medium truncate">
              {conversations.find((c) => c.id === activeId)?.title || '新会话'}
            </span>
            {loadingMessages && (
              <span className="text-xs text-muted flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block" />
                加载中
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm shadow-lg">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <ChatInterface
          conversationId={activeId}
          messages={messages}
          onMessagesChange={handleMessagesChange}
        />
      </div>
    </div>
  );
}
