'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageRenderer } from '@/components/chat/MessageRenderer';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatChart, type StatChartData } from '@/components/chat/StatChart';
import { MessageActions } from '@/components/chat/MessageActions';

interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  last_question: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationDetail {
  conversation: ConversationSummary;
  messages: {
    id: string;
    question: string;
    answer: string;
    sources: { title: string; similarity: number }[];
    stat_data?: StatChartData;
    created_at: string;
  }[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/** 会话内消息的具体时间：M月D日 HH:mm */
function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function HistoryView() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/conversations');
      if (!res.ok) throw new Error('获取失败');
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      setError('加载历史记录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  /** 展开/收起会话详情 */
  const toggleExpand = useCallback(
    async (conv: ConversationSummary) => {
      if (expandedId === conv.id) {
        setExpandedId(null);
        setExpandedDetail(null);
        return;
      }
      setExpandedId(conv.id);
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/conversations/${conv.id}`);
        if (!res.ok) throw new Error('加载失败');
        const data: ConversationDetail = await res.json();
        setExpandedDetail(data);
      } catch {
        setExpandedDetail(null);
      } finally {
        setLoadingDetail(false);
      }
    },
    [expandedId]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('删除失败');
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (expandedId === id) {
          setExpandedId(null);
          setExpandedDetail(null);
        }
        setPendingDelete(null);
      } catch {
        setError('删除会话失败');
      } finally {
        setDeletingId(null);
      }
    },
    [expandedId]
  );

  const handleClearAll = useCallback(async () => {
    setClearing(true);
    try {
      // 清空 = 删除所有会话（级联删除其下消息）
      await Promise.all(
        conversations.map((c) => fetch(`/api/conversations/${c.id}`, { method: 'DELETE' }))
      );
      setConversations([]);
      setExpandedId(null);
      setExpandedDetail(null);
      setShowClearConfirm(false);
    } catch {
      setError('清空记录失败');
    } finally {
      setClearing(false);
    }
  }, [conversations]);

  const filtered = searchQuery.trim()
    ? conversations.filter(
        (c) =>
          c.title.includes(searchQuery) ||
          (c.last_question || '').includes(searchQuery)
      )
    : conversations;

  const totalMessages = conversations.reduce((a, c) => a + c.message_count, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* 顶部工具栏 */}
      <div className="border-b border-border bg-surface px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <h1 className="text-lg font-semibold flex-shrink-0">问答历史</h1>
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索会话标题或问题..."
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={fetchConversations}
            disabled={loading}
            className="flex-shrink-0 p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors disabled:opacity-40"
            title="刷新"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m-15.356-2a8.003 8.003 0 0015.356 2m0 0H15"
              />
            </svg>
          </button>
          {conversations.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={loading}
              className="flex-shrink-0 p-2 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors disabled:opacity-40"
              title="清空全部"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 删除单条确认弹窗 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除会话"
        message={
          <>
            确定要删除会话「{pendingDelete?.title}」吗？
            <span className="block mt-2 px-3 py-2 rounded-lg bg-surface-hover text-foreground/80 text-xs line-clamp-2">
              {pendingDelete?.last_question || '（无消息）'}
            </span>
            <span className="block mt-2">
              该会话下的 {pendingDelete?.message_count ?? 0} 条消息将一并删除，无法恢复。
            </span>
          </>
        }
        loading={deletingId !== null}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete.id)}
        onCancel={() => !deletingId && setPendingDelete(null)}
      />

      {/* 清空全部确认弹窗 */}
      <ConfirmDialog
        open={showClearConfirm}
        title="清空所有记录"
        message={
          <>
            确定要删除全部 {conversations.length} 个会话、共 {totalMessages} 条问答记录吗？
            <span className="block mt-2">此操作不可撤销。</span>
          </>
        }
        confirmText="确定清空"
        loading={clearing}
        onConfirm={handleClearAll}
        onCancel={() => !clearing && setShowClearConfirm(false)}
      />

      {/* 会话分组列表 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-red-500 mb-3">{error}</p>
              <button
                onClick={fetchConversations}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover transition-colors"
              >
                重试
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold mb-2">暂无会话记录</h2>
              <p className="text-sm text-muted">
                {searchQuery ? '没有匹配的搜索结果' : '去问答页面开始提问吧'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((conv) => {
                const isExpanded = expandedId === conv.id;
                const isDeleting = deletingId === conv.id;
                return (
                  <div
                    key={conv.id}
                    className={`rounded-xl border border-border bg-surface overflow-hidden hover:border-primary/40 transition-colors ${
                      isDeleting ? 'opacity-50' : ''
                    }`}
                  >
                    {/* 会话头 */}
                    <div className="w-full flex items-start gap-3 p-4 text-left">
                      <button
                        onClick={() => toggleExpand(conv)}
                        className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground/5 flex items-center justify-center text-xs font-medium"
                      >
                        {isExpanded ? '−' : '+'}
                      </button>
                      <button
                        onClick={() => toggleExpand(conv)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="text-sm font-medium line-clamp-2">{conv.title}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted">
                          <span>{formatDate(conv.updated_at)}</span>
                          <span>· {conv.message_count} 条消息</span>
                          {conv.last_question && (
                            <span className="truncate">· {conv.last_question}</span>
                          )}
                          <svg
                            className={`w-3.5 h-3.5 text-muted transition-transform ml-auto flex-shrink-0 ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </button>
                      {/* 删除按钮 */}
                      <button
                        onClick={() => setPendingDelete(conv)}
                        disabled={isDeleting}
                        className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors disabled:opacity-40"
                        title="删除会话"
                      >
                        {isDeleting ? (
                          <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* 展开的会话内容（问答流） */}
                    {isExpanded && (
                      <div className="border-t border-border bg-background/50">
                        {loadingDetail ? (
                          <div className="flex items-center justify-center py-10 text-muted gap-2">
                            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs">加载中...</span>
                          </div>
                        ) : expandedDetail ? (
                          <div className="divide-y divide-border/70">
                            {/* 消息按时间倒序：最新记录置顶 */}
                            {[...expandedDetail.messages].reverse().map((item) => (
                              <div key={item.id} className="p-4 space-y-3">
                                <div className="text-xs text-muted flex items-center gap-2">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  {formatDateTime(item.created_at)}
                                </div>
                                {/* 问题 */}
                                <div className="flex gap-3">
                                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground/5 flex items-center justify-center text-xs font-medium">
                                    问
                                  </div>
                                  <p className="flex-1 min-w-0 text-sm font-medium whitespace-pre-wrap">
                                    {item.question}
                                  </p>
                                </div>
                                {/* 回答 */}
                                <div className="flex gap-3">
                                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                                    AI
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="markdown-body text-sm">
                                      <MessageRenderer content={item.answer} />
                                    </div>
                                    {item.stat_data && <StatChart data={item.stat_data} />}
                                    {item.sources && item.sources.length > 0 && (
                                      <div className="mt-3 pt-3 border-t border-border">
                                        <div className="text-xs text-muted mb-2">
                                          参考来源:
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                          {item.sources.map((s, i) => (
                                            <span
                                              key={i}
                                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-hover text-xs"
                                              title={`相似度: ${(s.similarity * 100).toFixed(1)}%`}
                                            >
                                              <svg
                                                className="w-3 h-3 text-primary"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                                />
                                              </svg>
                                              <span className="max-w-[200px] truncate">
                                                {s.title}
                                              </span>
                                              <span className="text-muted">
                                                {(s.similarity * 100).toFixed(0)}%
                                              </span>
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    <MessageActions
                                      content={item.answer}
                                      question={item.question}
                                      statData={item.stat_data}
                                      className="mt-2"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center py-10 text-muted text-sm">
                            加载失败，请重试
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
