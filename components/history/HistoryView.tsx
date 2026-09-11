'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageRenderer } from '@/components/chat/MessageRenderer';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatChart, type StatChartData } from '@/components/chat/StatChart';

interface HistoryItem {
  id: string;
  question: string;
  answer: string;
  sources: { title: string; similarity: number }[];
  stat_data?: StatChartData;
  created_at: string;
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

export function HistoryView() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HistoryItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error('获取失败');
      const data = await res.json();
      setHistory(data.history || []);
    } catch {
      setError('加载历史记录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('删除失败');
        setHistory((prev) => prev.filter((h) => h.id !== id));
        if (expandedId === id) setExpandedId(null);
        setPendingDelete(null);
      } catch {
        setError('删除记录失败');
      } finally {
        setDeletingId(null);
      }
    },
    [expandedId]
  );

  const handleClearAll = useCallback(async () => {
    setClearing(true);
    try {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (!res.ok) throw new Error('清空失败');
      setHistory([]);
      setExpandedId(null);
      setShowClearConfirm(false);
    } catch {
      setError('清空记录失败');
    } finally {
      setClearing(false);
    }
  }, []);

  const filtered = searchQuery.trim()
    ? history.filter(
        (h) =>
          h.question.includes(searchQuery) ||
          h.answer.includes(searchQuery)
      )
    : history;

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
              placeholder="搜索问题或回答..."
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={fetchHistory}
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
          {history.length > 0 && (
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

      {/* 删除单条记录确认弹窗 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除记录"
        message={
          <>
            确定要删除这条问答记录吗？
            {pendingDelete && (
              <span className="block mt-2 px-3 py-2 rounded-lg bg-surface-hover text-foreground/80 text-xs line-clamp-2">
                {pendingDelete.question}
              </span>
            )}
            <span className="block mt-2">删除后无法恢复。</span>
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
            确定要删除全部 {history.length} 条问答记录吗？此操作不可撤销。
          </>
        }
        confirmText="确定清空"
        loading={clearing}
        onConfirm={handleClearAll}
        onCancel={() => !clearing && setShowClearConfirm(false)}
      />

      {/* 列表 */}
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
                onClick={fetchHistory}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover transition-colors"
              >
                重试
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold mb-2">暂无问答记录</h2>
              <p className="text-sm text-muted">
                {searchQuery ? '没有匹配的搜索结果' : '去问答页面开始提问吧'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => {
                const isExpanded = expandedId === item.id;
                const isDeleting = deletingId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border border-border bg-surface overflow-hidden hover:border-primary/40 transition-colors ${isDeleting ? 'opacity-50' : ''}`}
                  >
                    {/* 问题行 */}
                    <div className="w-full flex items-start gap-3 p-4 text-left">
                      <button
                        onClick={() =>
                          setExpandedId(isExpanded ? null : item.id)
                        }
                        className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground/5 flex items-center justify-center text-xs font-medium"
                      >
                        问
                      </button>
                      <button
                        onClick={() =>
                          setExpandedId(isExpanded ? null : item.id)
                        }
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="text-sm font-medium line-clamp-2">
                          {item.question}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs text-muted">
                            {formatDate(item.created_at)}
                          </span>
                          {item.sources && item.sources.length > 0 && (
                            <span className="text-xs text-muted">
                              · {item.sources.length} 个来源
                            </span>
                          )}
                          <svg
                            className={`w-3.5 h-3.5 text-muted transition-transform ml-auto ${
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
                        onClick={() => setPendingDelete(item)}
                        disabled={isDeleting}
                        className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors disabled:opacity-40"
                        title="删除"
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

                    {/* 展开的回答 */}
                    {isExpanded && (
                      <div className="border-t border-border p-4 bg-background/50">
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
                          </div>
                        </div>
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
