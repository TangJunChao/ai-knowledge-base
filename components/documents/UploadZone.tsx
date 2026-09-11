'use client';

import { useState, useRef, useCallback } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

interface UploadZoneProps {
  onUploadSuccess: () => void;
}

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  title?: string;
  message?: string;
  fileName?: string;
}

/** 允许上传的文件扩展名（均已在解析层实现支持） */
const ALLOWED_EXTENSIONS = [
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

/**
 * 旧版二进制 Word 格式。
 * 解析库（mammoth）只支持 OOXML，无法读取 .doc，这里单独识别以便给出可操作提示。
 */
const LEGACY_DOC_EXTENSIONS = ['doc'];

/** 允许上传的 MIME 类型 */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/html',
];

/** 支持的文件类型分组提示 */
const SUPPORTED_GROUPS = [
  { label: '文档', items: ['PDF', 'Word (.docx)'] },
  { label: '表格', items: ['Excel', 'CSV'] },
  { label: '文本', items: ['Markdown', 'TXT', 'HTML'] },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return '';
  return filename.slice(dotIndex + 1).toLowerCase();
}

interface ValidationResult {
  ok: boolean;
  title?: string;
  message?: string;
}

/**
 * 客户端文件校验：类型 + 大小 + 空文件
 */
function validateFile(file: File): ValidationResult {
  // 1. 空文件
  if (file.size === 0) {
    return {
      ok: false,
      title: '文件为空',
      message: `${file.name} 没有任何内容，请换一个文件。`,
    };
  }

  // 2. 类型校验（扩展名 / MIME / 旧版 .doc）
  const typeError = validateTypeByMeta(file.name, file.type);
  if (typeError) {
    return { ok: false, ...typeError };
  }

  // 3. 文件过大
  if (file.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      title: '文件过大',
      message: `${file.name} 大小为 ${formatFileSize(
        file.size
      )}，超出 ${formatFileSize(MAX_FILE_SIZE)} 上限，请拆分后再上传。`,
    };
  }

  return { ok: true };
}

/**
 * 拖拽悬浮阶段的轻量类型判断（只看扩展名与 MIME，不读取内容）
 */
function isTypeSupported(file: File): boolean {
  return validateTypeByMeta(file.name, file.type) === null;
}

/**
 * 类型元信息校验，通过返回 null，否则返回错误描述
 */
function validateTypeByMeta(
  filename: string,
  mimeType: string
): { title: string; message: string } | null {
  const ext = getExtension(filename);

  if (!ext) {
    return {
      title: '无法识别文件类型',
      message: `${filename} 没有扩展名。支持的类型：${ALLOWED_EXTENSIONS.map(
        (e) => '.' + e
      ).join('、')}`,
    };
  }

  if (LEGACY_DOC_EXTENSIONS.includes(ext)) {
    return {
      title: '旧版 Word（.doc）暂不支持',
      message: `${filename} 是旧版二进制格式。请用 Word 打开后「另存为」.docx 再上传。`,
    };
  }

  const extAllowed = ALLOWED_EXTENSIONS.includes(ext);
  const mimeAllowed = mimeType ? ALLOWED_MIME_TYPES.includes(mimeType) : false;

  if (!extAllowed && !mimeAllowed) {
    return {
      title: `不支持 .${ext} 格式`,
      message: `无法解析 .${ext} 文件。支持的类型：${ALLOWED_EXTENSIONS.map(
        (e) => '.' + e
      ).join('、')}`,
    };
  }

  return null;
}

/** 从文件名提取标题（与后端 parseFile 一致：去掉最后一个扩展名） */
function extractTitle(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex > 0) return filename.slice(0, dotIndex);
  return filename;
}

export function UploadZone({ onUploadSuccess }: UploadZoneProps) {
  // none: 未拖拽 / valid: 可接受的单个文件 / invalid: 多文件或类型不支持
  const [dragHint, setDragHint] = useState<'none' | 'valid' | 'invalid'>('none');
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
  const [pendingReplace, setPendingReplace] = useState<{ file: File; title: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 真正执行上传；replaceTitle 存在时表示覆盖同名旧文档 */
  const performUpload = useCallback(
    async (file: File, replaceTitle?: string) => {
      setUploadState({ status: 'uploading', fileName: file.name });

      const formData = new FormData();
      formData.append('file', file);
      if (replaceTitle) {
        formData.append('replaceTitle', replaceTitle);
      }

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || '上传失败');
        }

        setUploadState({
          status: 'success',
          fileName: file.name,
          title: data.replaced ? '已更新' : '上传成功',
          message: `${file.name} · 生成 ${data.chunkCount} 个片段 · ${formatFileSize(
            data.fileSize
          )}${data.replaced ? ' · 已覆盖旧版本' : ''}`,
        });

        onUploadSuccess();

        setTimeout(() => {
          setUploadState({ status: 'idle' });
        }, 4000);
      } catch (error) {
        setUploadState({
          status: 'error',
          fileName: file.name,
          title: '上传失败',
          message: error instanceof Error ? error.message : '上传失败',
        });
        setTimeout(() => {
          setUploadState({ status: 'idle' });
        }, 6000);
      }
    },
    [onUploadSuccess]
  );

  const handleUpload = useCallback(
    async (file: File) => {
      // 先做客户端校验，不通过就直接提示，不发请求
      const validation = validateFile(file);
      if (!validation.ok) {
        setUploadState({
          status: 'error',
          fileName: file.name,
          title: validation.title,
          message: validation.message,
        });
        setTimeout(() => {
          setUploadState({ status: 'idle' });
        }, 6000);
        return;
      }

      // 检查是否已有同名文档（标题一致则提示覆盖）
      try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        const docs: { title: string }[] = data.documents || [];
        const title = extractTitle(file.name);
        if (docs.some((d) => d.title === title)) {
          setPendingReplace({ file, title });
          return;
        }
      } catch {
        // 列表获取失败不阻塞上传，直接按普通上传处理
      }

      await performUpload(file);
    },
    [performUpload]
  );

  // 拖拽时提前预览是否可接受，给出视觉反馈（红/绿边框）
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) {
      setDragHint('none');
      return;
    }

    if (items.length > 1) {
      setDragHint('invalid');
      return;
    }

    const item = items[0];
    if (item.kind !== 'file') {
      setDragHint('invalid');
      return;
    }

    const file = item.getAsFile();
    if (!file) {
      // 部分浏览器在 dragover 阶段拿不到文件对象，保持中性态
      setDragHint('none');
      return;
    }

    setDragHint(isTypeSupported(file) ? 'valid' : 'invalid');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragHint('none');

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      if (files.length > 1) {
        setUploadState({
          status: 'error',
          title: '一次只能上传一个文件',
          message: `检测到 ${files.length} 个文件，请逐个上传。`,
        });
        setTimeout(() => setUploadState({ status: 'idle' }), 6000);
        return;
      }

      handleUpload(files[0]);
    },
    [handleUpload]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleUpload(file);
      }
      e.target.value = '';
    },
    [handleUpload]
  );

  const isError = uploadState.status === 'error';

  return (
    <div>
      {/* 重名覆盖确认弹窗 */}
      <ConfirmDialog
        open={pendingReplace !== null}
        title="已存在同名文档"
        message={
          <>
            知识库中已有「<span className="text-foreground font-medium">{pendingReplace?.title}</span>
            」，再次上传会用新文件<strong>覆盖旧版本</strong>并重新解析，确定继续吗？
          </>
        }
        confirmText="覆盖并重新解析"
        onConfirm={() => {
          const pending = pendingReplace;
          setPendingReplace(null);
          if (pending) performUpload(pending.file, pending.title);
        }}
        onCancel={() => setPendingReplace(null)}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={(e) => {
          // 只有真正离开容器时才清除，避免掠过子元素导致闪烁
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragHint('none');
          }
        }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
          dragHint === 'valid'
            ? 'border-primary bg-primary/5'
            : dragHint === 'invalid'
              ? 'border-red-400 bg-red-50'
              : isError
                ? 'border-red-300 hover:border-red-400'
                : 'border-border hover:border-primary/50 hover:bg-surface-hover'
        }`}
      >
        {/* accept 保留 .doc：让用户能选中并收到「请另存为 .docx」的明确提示，而不是文件被置灰 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.md,.markdown,.txt,.html,.htm,.xlsx,.xls,.csv"
          onChange={handleFileSelect}
          className="hidden"
        />

        {uploadState.status === 'uploading' ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted">
              正在处理 {uploadState.fileName}... (解析、分块、生成向量)
            </p>
          </div>
        ) : uploadState.status === 'success' ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-green-600">
              {uploadState.title || '上传成功'}
            </p>
            {uploadState.message && (
              <p className="text-xs text-muted">{uploadState.message}</p>
            )}
          </div>
        ) : uploadState.status === 'error' ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-red-600">
              {uploadState.title || '上传失败'}
            </p>
            {uploadState.message && (
              <p className="text-xs text-red-500/80 max-w-md">{uploadState.message}</p>
            )}
            <p className="text-xs text-muted mt-1">点击可重新选择文件</p>
          </div>
        ) : dragHint === 'invalid' ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <p className="text-sm font-medium text-red-600">该文件无法上传</p>
            <p className="text-xs text-red-500/80">
              仅支持 {ALLOWED_EXTENSIONS.map((e) => '.' + e).join('、')}，且一次只能一个文件
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">
                拖拽文件到此处，或点击上传
              </p>
              <p className="text-xs text-muted mt-1">
                单个文件，最大 {formatFileSize(MAX_FILE_SIZE)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 支持格式提示 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        {SUPPORTED_GROUPS.map((group) => (
          <div key={group.label} className="flex items-center gap-1.5">
            <span className="text-xs text-muted">{group.label}</span>
            {group.items.map((item) => (
              <span
                key={item}
                className="px-1.5 py-0.5 rounded text-[11px] bg-surface-hover text-muted"
              >
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-2 px-1 leading-relaxed">
        不支持图片、音视频、压缩包等格式；旧版 Word（.doc）请另存为 .docx；扫描版 PDF
        需先转为可复制文本。
      </p>
    </div>
  );
}
