'use client';

import { useState, useRef, useEffect } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  last_question: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / M月D日 */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} 小时前`;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * 左侧会话栏：新建 / 切换 / 删除 / 重命名会话
 */
export function ConversationSidebar({
  conversations,
  activeId,
  loading,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: ConversationSidebarProps) {
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const startRename = (conv: ConversationSummary) => {
    setEditingId(conv.id);
    setEditValue(conv.title === '新对话' ? '' : conv.title);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <aside className="w-64 flex-shrink-0 border-r border-border bg-surface flex flex-col">
      {/* 新建会话 */}
      <div className="p-3 border-b border-border">
        <button
          onClick={onCreate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建会话
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted gap-2">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">加载中...</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <p className="text-sm text-muted mb-1">还没有会话</p>
            <p className="text-xs text-muted/70">点击上方"新建会话"开始提问</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => {
              const active = conv.id === activeId;
              const isEditing = editingId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group relative rounded-lg transition-colors ${
                    active
                      ? 'bg-primary/10 text-foreground'
                      : 'hover:bg-surface-hover'
                  }`}
                >
                  {isEditing ? (
                    <div className="px-2 py-1.5">
                      <input
                        ref={inputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        placeholder="输入会话标题"
                        className="w-full rounded-md border border-primary bg-background px-2 py-1 text-sm focus:outline-none"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => onSelect(conv.id)}
                      className="w-full text-left px-3 py-2"
                      title={conv.last_question || conv.title}
                    >
                      <p className="text-sm truncate font-medium">{conv.title}</p>
                      <p className="text-xs text-muted mt-0.5 truncate">
                        {conv.last_question
                          ? conv.last_question
                          : '暂无消息'}
                        <span className="ml-1.5">{formatTime(conv.updated_at)}</span>
                      </p>
                    </button>
                  )}

                  {/* 悬停操作：重命名 / 删除 */}
                  {!isEditing && (
                    <div
                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-lg bg-surface/90 px-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                        active ? 'bg-primary/10' : ''
                      }`}
                    >
                      <button
                        onClick={() => startRename(conv)}
                        className="p-1 rounded-md hover:bg-surface-hover text-muted hover:text-foreground"
                        title="重命名"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setPendingDelete(conv)}
                        className="p-1 rounded-md hover:bg-red-50 text-muted hover:text-red-500"
                        title="删除会话"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除会话"
        message={
          <>
            确定要删除会话「{pendingDelete?.title}」吗？
            <span className="block mt-2">该会话下的 {pendingDelete?.message_count ?? 0} 条消息将一并删除，无法恢复。</span>
          </>
        }
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
    </aside>
  );
}
