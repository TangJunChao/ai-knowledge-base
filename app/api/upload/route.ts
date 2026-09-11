/**
 * 文档上传 API
 * 接收文件，解析文本，分块，生成向量，存入数据库
 *
 * POST /api/upload
 * Body: FormData (file: File, replaceId?: string, replaceTitle?: string)
 * Response: { documentId, title, chunkCount, fileType, fileSize, replaced }
 *
 * 覆盖更新（文档更新/重新解析）：
 * - replaceId: 上传成功后删除指定 ID 的旧文档
 * - replaceTitle: 上传成功后删除所有同名旧文档（前端重名覆盖场景）
 */

import { NextRequest } from 'next/server';
import { parseFile } from '@/lib/file-parsers';
import { ingestDocument, deleteDocument, getAllDocuments } from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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

/** 旧版二进制 Word：格式可识别但解析库（mammoth）不支持 */
const LEGACY_DOC_EXTENSIONS = ['doc'];

const EXTENSION_HINT = ALLOWED_EXTENSIONS.map((e) => '.' + e).join('、');

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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const replaceId = (formData.get('replaceId') as string | null) || undefined;
    const replaceTitle = (formData.get('replaceTitle') as string | null) || undefined;

    if (!file) {
      return Response.json(
        { error: '没有接收到文件，请重新选择后再上传。' },
        { status: 400 }
      );
    }

    // 1. 空文件校验
    if (file.size === 0) {
      return Response.json(
        { error: `「${file.name}」是空文件，请换一个有内容的文件。` },
        { status: 400 }
      );
    }

    // 2. 文件大小校验
    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        {
          error: `「${file.name}」大小为 ${formatFileSize(
            file.size
          )}，超出 ${formatFileSize(MAX_FILE_SIZE)} 上限，请拆分后再上传。`,
        },
        { status: 413 }
      );
    }

    // 3. 文件类型校验（扩展名或 MIME 任一命中即通过）
    const ext = getExtension(file.name);

    // 3.1 旧版 .doc：格式可识别但解析库不支持，给出可操作指引
    if (ext && LEGACY_DOC_EXTENSIONS.includes(ext)) {
      return Response.json(
        {
          error: `「${file.name}」是旧版二进制 Word 格式，暂不支持解析。请用 Word 打开后「另存为」.docx 再上传。`,
        },
        { status: 415 }
      );
    }

    const extAllowed = ext ? ALLOWED_EXTENSIONS.includes(ext) : false;
    const mimeAllowed = file.type
      ? ALLOWED_MIME_TYPES.includes(file.type)
      : false;

    if (!extAllowed && !mimeAllowed) {
      if (!ext) {
        return Response.json(
          {
            error: `「${file.name}」没有扩展名，无法识别文件类型。当前支持的类型：${EXTENSION_HINT}`,
          },
          { status: 415 }
        );
      }
      return Response.json(
        {
          error: `「${file.name}」是不支持的 .${ext} 格式。当前支持的类型：${EXTENSION_HINT}`,
        },
        { status: 415 }
      );
    }

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 解析文件（解析失败属于文件内容问题，返回 400 而不是 500）
    let parsed;
    try {
      parsed = await parseFile(buffer, file.name, file.type);
    } catch (parseError) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : '文件解析失败，请确认文件未损坏。';
      return Response.json(
        { error: `解析「${file.name}」失败：${message}` },
        { status: 400 }
      );
    }

    // 收集待覆盖的旧文档 ID（在新文档入库前记录，避免误删新文档）
    const replacedIds: string[] = [];
    if (replaceId) {
      replacedIds.push(replaceId);
    } else if (replaceTitle) {
      try {
        const docs = await getAllDocuments();
        for (const d of docs) {
          if (d.title === replaceTitle) replacedIds.push(d.id);
        }
      } catch (error) {
        console.error('Failed to list documents for replace:', error);
      }
    }

    // 入库（分块 + 生成向量 + 存储）
    const result = await ingestDocument(
      parsed.text,
      parsed.title,
      parsed.sourceType,
      parsed.fileSize,
      parsed.tableData
    );

    // 新文档入库成功后，再删除旧文档（按 ID 精确删除，避免误删刚入库的新文档）
    for (const id of replacedIds) {
      if (id === result.documentId) continue;
      try {
        await deleteDocument(id);
      } catch (error) {
        console.error(`Failed to delete replaced document ${id}:`, error);
      }
    }

    return Response.json({
      documentId: result.documentId,
      title: parsed.title,
      chunkCount: result.chunkCount,
      fileType: parsed.sourceType,
      fileSize: parsed.fileSize,
      replaced: replacedIds.length > 0,
    });
  } catch (error) {
    console.error('Upload API error:', error);
    const message =
      error instanceof Error ? error.message : '上传处理失败';
    return Response.json({ error: message }, { status: 500 });
  }
}
