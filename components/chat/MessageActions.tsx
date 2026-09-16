'use client';

import { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageRenderer } from './MessageRenderer';

interface MessageActionsProps {
  /** 回答的 Markdown 原文 */
  content: string;
  /** 对应的用户问题（用于生成导出文件名） */
  question?: string;
  className?: string;
}

/** 打印窗口内联的 Markdown 排版样式（与网页端 globals.css 保持一致） */
const PRINT_MARKDOWN_CSS = `
.markdown-body { line-height: 1.7; word-wrap: break-word; }
.markdown-body p { margin-bottom: 0.75rem; }
.markdown-body p:last-child { margin-bottom: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; }
.markdown-body h1 { font-size: 1.5rem; }
.markdown-body h2 { font-size: 1.25rem; }
.markdown-body h3 { font-size: 1.125rem; }
.markdown-body ul, .markdown-body ol { margin-bottom: 0.75rem; padding-left: 1.5rem; }
.markdown-body li { margin-bottom: 0.25rem; }
.markdown-body code { background: #f4f4f5; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875em; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; }
.markdown-body pre { background: #18181b; color: #fafafc; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 0.75rem; }
.markdown-body pre code { background: transparent; padding: 0; }
.markdown-body blockquote { border-left: 3px solid #4f46e5; padding-left: 1rem; color: #71717a; margin-bottom: 0.75rem; }
.markdown-body table { width: 100%; border-collapse: collapse; margin-bottom: 0.75rem; }
.markdown-body th, .markdown-body td { border: 1px solid #e4e4e7; padding: 0.5rem 0.75rem; text-align: left; }
.markdown-body th { background: #f4f4f5; font-weight: 600; }
`;

function safeFileName(question?: string): string {
  const base = (question || 'AI回答')
    .replace(/[\\/:*?"<>|\r\n]/g, ' ')
    .trim()
    .slice(0, 30);
  return base || 'AI回答';
}

/**
 * 回答操作按钮：复制 Markdown / 导出 .md / 导出 PDF
 */
export function MessageActions({ content, question, className }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默失败，按钮保持原样
    }
  }, [content]);

  const handleExportMd = useCallback(() => {
    const filename = `${safeFileName(question)}.md`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [content, question]);

  /**
   * 导出 PDF：复用 MessageRenderer 渲染出与网页一致的排版，
   * 打开一个隐藏打印窗口后调用浏览器原生打印（可"另存为 PDF"）。
   * 零第三方依赖，离线可用，中文 / 表格 / 代码块渲染完整。
   */
  const handleExportPdf = useCallback(() => {
    const win = window.open('', '_blank', 'width=860,height=640');
    if (!win) return;

    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeFileName(question)}</title>` +
        `<style>
          body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; color: #18181b; padding: 40px; }
          @media print { @page { margin: 1.6cm; } body { padding: 0; } }
          ${PRINT_MARKDOWN_CSS}
        </style></head><body><div id="pdf-root"></div></body></html>`
    );
    win.document.close();

    const root = createRoot(win.document.getElementById('pdf-root')!);
    root.render(<MessageRenderer content={content} />);

    // 等渲染完成再触发打印（print 会阻塞到用户关闭打印对话框）
    setTimeout(() => {
      win.focus();
      win.print();
      root.unmount();
      win.close();
    }, 600);
  }, [content, question]);

  const btnClass =
    'p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors';

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <button onClick={handleCopy} className={btnClass} title={copied ? '已复制' : '复制 Markdown'}>
        {copied ? (
          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>

      <button onClick={handleExportMd} className={btnClass} title="导出为 Markdown (.md)">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </button>

      <button onClick={handleExportPdf} className={btnClass} title="导出为 PDF">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H9.5L5 7.5V19a2 2 0 002 2zM5 7.5H9.5V3" />
        </svg>
      </button>
    </div>
  );
}
