'use client';

import { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageRenderer } from './MessageRenderer';
import type { StatChartData } from './StatChart';

interface MessageActionsProps {
  /** 回答的 Markdown 原文 */
  content: string;
  /** 对应的用户问题（用于生成导出文件名） */
  question?: string;
  /** 统计问答的图表数据（导出 PDF / MD 时一并包含） */
  statData?: StatChartData;
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

const OP_LABEL: Record<StatChartData['operation'], string> = {
  sum: '合计',
  avg: '平均',
  count: '数量',
  max: '最大值',
  min: '最小值',
};

const CHART_W = 720;
const CHART_H = 320;
const CHART_PAD_L = 64;
const CHART_PAD_R = 20;
const CHART_PAD_T = 28;
const CHART_PAD_B = 56;

function safeFileName(question?: string): string {
  const base = (question || 'AI回答')
    .replace(/[\\/:*?"<>|\r\n]/g, ' ')
    .trim()
    .slice(0, 30);
  return base || 'AI回答';
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/** 把 "2025年1月" 简化为 "25/1"，适合做坐标轴刻度 */
function shortKey(key: string): string {
  const m = key.match(/(20\d{2})年(\d{1,2})月/);
  if (m) return `${m[1].slice(2)}/${m[2]}`;
  return key.length > 8 ? key.slice(0, 8) : key;
}

/**
 * 把统计分组数据渲染为静态 SVG 柱状图字符串（零依赖、固定配色）。
 * 与 StatChart 同布局算法，供 PDF 打印窗口 / MD 内嵌图片使用。
 */
function chartToSvg(data: StatChartData): string {
  const groups = data.groups || [];
  if (groups.length === 0) return '';

  const plotW = CHART_W - CHART_PAD_L - CHART_PAD_R;
  const plotH = CHART_H - CHART_PAD_T - CHART_PAD_B;
  const n = groups.length;

  // 取整的刻度上限（1/2/2.5/5 × 10^k），与页面图表一致
  const raw = Math.max(...groups.map((g) => g.value), 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let nice = Math.ceil(raw / mag) * mag;
  if (nice / mag <= 2) nice = 2 * mag;
  else if (nice / mag <= 2.5) nice = 2.5 * mag;
  else if (nice / mag <= 5) nice = 5 * mag;
  else nice = 10 * mag;
  const maxVal = nice;

  const slot = plotW / Math.max(n, 1);
  const barW = Math.min(slot * 0.58, 46);
  const centerX = (i: number) => CHART_PAD_L + slot * i + slot / 2;
  const yOf = (v: number) => CHART_PAD_T + plotH - (v / maxVal) * plotH;
  // 刻度标签是否足够宽（分组多时隐藏部分标签，避免重叠）
  const labelEvery = slot < 34 ? 2 : 1;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((r) => {
      const y = CHART_PAD_T + plotH - r * plotH;
      return `<line x1="${CHART_PAD_L}" x2="${CHART_W - CHART_PAD_R}" y1="${y}" y2="${y}" stroke="#e4e4e7" stroke-width="1" stroke-dasharray="${r === 0 ? '0' : '4 4'}"/><text x="${CHART_PAD_L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#71717a">${fmtNum(r * maxVal)}</text>`;
    })
    .join('');

  const bars = groups
    .map((g, i) => {
      const h = Math.max((g.value / maxVal) * plotH, 1.5);
      const x = centerX(i) - barW / 2;
      const y = yOf(g.value);
      const label =
        n <= 16
          ? `<text x="${centerX(i)}" y="${y - 5}" text-anchor="middle" font-size="10" fill="#71717a">${fmtNum(g.value)}</text>`
          : '';
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="#4f46e5" opacity="0.92"/>${label}`;
    })
    .join('');

  const xLabels = groups
    .map((g, i) =>
      i % labelEvery === 0
        ? `<text x="${centerX(i)}" y="${CHART_H - CHART_PAD_B + 20}" text-anchor="middle" font-size="11" fill="#71717a">${escHtml(shortKey(g.key))}</text>`
        : ''
    )
    .join('');

  const title = `${escHtml(data.targetColumn)}（${OP_LABEL[data.operation] ?? data.operation}）`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_W} ${CHART_H}" width="100%" font-family="PingFang SC, Microsoft YaHei, Segoe UI, sans-serif" role="img" aria-label="${title}"><rect width="${CHART_W}" height="${CHART_H}" fill="#ffffff"/><text x="${CHART_PAD_L}" y="20" font-size="14" font-weight="600" fill="#18181b">${title}</text>${grid}${bars}${xLabels}</svg>`;
}

/** SVG 字符串 → base64 data URL（兼容中文） */
function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:image/svg+xml;base64,' + btoa(bin);
}

/** 统计图表数据 → Markdown 段落（数据表格 + 内嵌 SVG 图片） */
function buildChartMarkdown(data: StatChartData): string {
  const groups = data.groups || [];
  const lines: string[] = [];
  lines.push('## 统计图表');
  lines.push('');
  lines.push(`- **指标**：${data.targetColumn}（${OP_LABEL[data.operation] ?? data.operation}）`);
  if (data.total !== null) {
    lines.push(`- **${OP_LABEL[data.operation] ?? data.operation}总额**：${fmtNum(data.total)}`);
  }
  if (data.filters.length > 0) {
    lines.push(`- **筛选条件**：${data.filters.join('，')}`);
  }
  lines.push('');
  lines.push('| 分组 | 数值 |');
  lines.push('| --- | ---: |');
  for (const g of groups) {
    lines.push(`| ${g.key} | ${fmtNum(g.value)} |`);
  }
  lines.push('');
  const svg = chartToSvg(data);
  if (svg) {
    lines.push(`![${data.targetColumn}图表](${svgToDataUrl(svg)})`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * 回答操作按钮：复制 Markdown / 导出 .md / 导出 PDF
 */
export function MessageActions({ content, question, statData, className }: MessageActionsProps) {
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
    const parts = [content];
    if (statData) {
      const chartMd = buildChartMarkdown(statData);
      if (chartMd) parts.push(chartMd);
    }
    const md = parts.filter(Boolean).join('\n\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [content, question, statData]);

  /**
   * 导出 PDF：复用 MessageRenderer 渲染出与网页一致的排版（含统计图表），
   * 打开一个隐藏打印窗口后调用浏览器原生打印（可"另存为 PDF"）。
   * 零第三方依赖，离线可用，中文 / 表格 / 代码块 / 图表渲染完整。
   */
  const handleExportPdf = useCallback(() => {
    const win = window.open('', '_blank', 'width=860,height=640');
    if (!win) return;

    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeFileName(question)}</title>` +
        `<style>
          body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; color: #18181b; padding: 40px; }
          @media print { @page { margin: 1.6cm; } body { padding: 0; } }
          .stat-chart { margin-top: 1.25rem; }
          .stat-chart svg { width: 100%; height: auto; }
          ${PRINT_MARKDOWN_CSS}
        </style></head><body><div id="pdf-root"></div></body></html>`
    );
    win.document.close();

    const svg = statData ? chartToSvg(statData) : '';
    const root = createRoot(win.document.getElementById('pdf-root')!);
    root.render(
      <>
        <MessageRenderer content={content} />
        {svg && <div className="stat-chart" dangerouslySetInnerHTML={{ __html: svg }} />}
      </>
    );

    // 等渲染完成再触发打印（print 会阻塞到用户关闭打印对话框）
    setTimeout(() => {
      win.focus();
      win.print();
      root.unmount();
      win.close();
    }, 600);
  }, [content, question, statData]);

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
