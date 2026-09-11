'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

interface DocumentItem {
  id: string;
  title: string;
  source_type: string;
  chunk_count: number;
  created_at: string;
}

/** 更新（覆盖上传）允许的扩展名 */
const UPDATE_ALLOWED_EXTENSIONS = [
  'pdf',
  'docx',
  'md',
  'markdown',
  'txt',
  'html',
  'htm',
  'xlsx',
  'xls',
  'csv',
];

const UPDATE_MAX_SIZE = 10 * 1024 * 1024;

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return '';
  return filename.slice(dotIndex + 1).toLowerCase();
}

/** 更新文件轻量校验，返回错误信息或 null */
function validateUpdateFile(file: File): string | null {
  if (file.size === 0) return '文件为空，请换一个有内容的文件。';
  if (file.size > UPDATE_MAX_SIZE) return '文件超过 10MB 上限，请拆分后再上传。';
  const ext = getExtension(file.name);
  if (ext && !UPDATE_ALLOWED_EXTENSIONS.includes(ext)) {
    return `不支持的 .${ext} 格式。支持：${UPDATE_ALLOWED_EXTENSIONS.map((e) => '.' + e).join('、')}`;
  }
  return null;
}

const FILE_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  pdf: { label: 'PDF', color: 'bg-red-100 text-red-700' },
  docx: { label: 'DOC', color: 'bg-blue-100 text-blue-700' },
  xlsx: { label: 'XLS', color: 'bg-green-100 text-green-700' },
  markdown: { label: 'MD', color: 'bg-purple-100 text-purple-700' },
  txt: { label: 'TXT', color: 'bg-gray-100 text-gray-700' },
  html: { label: 'HTML', color: 'bg-orange-100 text-orange-700' },
  text: { label: 'TXT', color: 'bg-gray-100 text-gray-700' },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DocumentList() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<{ content: string; chunk_index: number }[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 更新（覆盖上传）相关状态
  const [pendingReplace, setPendingReplace] = useState<{ id: string; title: string; file: File } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const updateFileInputRef = useRef<HTMLInputElement>(null);
  const updateTargetRef = useRef<{ id: string; title: string } | null>(null);

  const showUpdateMsg = useCallback((type: 'success' | 'error', text: string) => {
    setUpdateMsg({ type, text });
    setTimeout(() => setUpdateMsg(null), 5000);
  }, []);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(true);
      try {
        const res = await fetch(`/api/documents?id=${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('删除失败');
        setDocuments((prev) => prev.filter((doc) => doc.id !== id));
        if (expandedId === id) setExpandedId(null);
        setPendingDelete(null);
      } catch (err) {
        console.error('Delete failed:', err);
        alert('删除失败，请重试');
      } finally {
        setDeleting(false);
      }
    },
    [expandedId]
  );

  const handleViewChunks = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(id);
    setChunksLoading(true);
    try {
      const res = await fetch(`/api/documents?detail=${id}`);
      const data = await res.json();
      setChunks(data.chunks || []);
    } catch (err) {
      console.error('Failed to fetch chunks:', err);
      setChunks([]);
    } finally {
      setChunksLoading(false);
    }
  }, [expandedId]);

  /** 点击"更新"：记录目标文档并弹出文件选择 */
  const handleUpdateClick = useCallback((doc: DocumentItem) => {
    updateTargetRef.current = { id: doc.id, title: doc.title };
    updateFileInputRef.current?.click();
  }, []);

  /** 选中更新文件：校验通过后弹覆盖确认 */
  const handleUpdateFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = updateTargetRef.current;
    updateTargetRef.current = null;
    if (!file || !target) return;

    const error = validateUpdateFile(file);
    if (error) {
      showUpdateMsg('error', `更新「${target.title}」失败：${error}`);
      return;
    }
    setPendingReplace({ id: target.id, title: target.title, file });
  }, [showUpdateMsg]);

  /** 确认后执行覆盖上传（带 replaceId） */
  const performUpdate = useCallback(async () => {
    if (!pendingReplace) return;
    setUpdating(true);
    const { id, title, file } = pendingReplace;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('replaceId', id);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '更新失败');
      showUpdateMsg('success', `已更新「${title}」并重新解析（${data.chunkCount} 个片段）`);
      fetchDocuments();
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      showUpdateMsg('error', `更新「${title}」失败：${err instanceof Error ? err.message : '请重试'}`);
    } finally {
      setUpdating(false);
      setPendingReplace(null);
    }
  }, [pendingReplace, expandedId, fetchDocuments, showUpdateMsg]);

  return (
    <div>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除文档"
        message={
          <>
            确定要删除文档「<span className="text-foreground font-medium">{pendingDelete?.title}</span>
            」及其所有分块吗？删除后无法恢复。
          </>
        }
        loading={deleting}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete.id)}
        onCancel={() => !deleting && setPendingDelete(null)}
      />

      {/* 更新（覆盖上传）确认弹窗 */}
      <ConfirmDialog
        open={pendingReplace !== null}
        title="更新文档"
        message={
          <>
            将用新文件覆盖「<span className="text-foreground font-medium">{pendingReplace?.title}</span>
            」并重新解析，确定继续吗？
          </>
        }
        confirmText="覆盖并重新解析"
        loading={updating}
        onConfirm={performUpdate}
        onCancel={() => !updating && setPendingReplace(null)}
      />

      {/* 隐藏的文件选择框（用于更新） */}
      <input
        ref={updateFileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.xlsx,.xls,.csv"
        onChange={handleUpdateFileChange}
        className="hidden"
      />

      {/* 更新结果提示条 */}
      {updateMsg && (
        <div
          className={`mb-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 animate-fade-in ${
            updateMsg.type === 'success'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          <span>{updateMsg.text}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          <p className="text-sm">暂无文档，请上传文档构建知识库</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const badge = FILE_TYPE_BADGE[doc.source_type] || FILE_TYPE_BADGE.text;
            const isExpanded = expandedId === doc.id;

            return (
              <div
                key={doc.id}
                className="rounded-xl border border-border bg-surface overflow-hidden transition-all"
              >
                <div className="flex items-center gap-3 p-4">
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold ${badge.color}`}>
                    {badge.label}
                  </span>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium truncate">{doc.title}</h3>
                    <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                      <span>{doc.chunk_count} 个片段</span>
                      <span>{formatDate(doc.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleViewChunks(doc.id)}
                      className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
                      title={isExpanded ? '收起' : '查看分块'}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleUpdateClick(doc)}
                      className="p-2 rounded-lg hover:bg-primary/10 text-muted hover:text-primary transition-colors"
                      title="更新/重新上传（覆盖并重新解析）"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m-15.356-2a8.003 8.003 0 0015.356 2m0 0H15" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setPendingDelete({ id: doc.id, title: doc.title })}
                      className="p-2 rounded-lg hover:bg-red-50 text-muted hover:text-red-600 transition-colors"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border bg-background max-h-96 overflow-y-auto animate-slide-up">
                    {chunksLoading ? (
                      <div className="flex justify-center py-6">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : chunks.length > 0 ? (
                      <div className="p-4 space-y-3">
                        {chunks.map((chunk, i) => (
                          <div key={i} className="text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="px-1.5 py-0.5 rounded bg-surface-hover text-muted font-mono">
                                #{chunk.chunk_index}
                              </span>
                            </div>
                            <p className="text-muted leading-relaxed line-clamp-3">
                              {chunk.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-sm text-muted">
                        无分块数据
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
  );
}
