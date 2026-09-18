/**
 * 文档管理 API（仅当前登录用户，多用户隔离）
 *
 * GET    /api/documents        - 获取文档列表
 * GET    /api/documents?detail=xxx - 获取文档分块详情
 * DELETE /api/documents?id=xxx - 删除文档（仅本人）
 */

import { NextRequest } from 'next/server';
import {
  getAllDocuments,
  deleteDocument,
  getDocumentChunks,
} from '@/lib/rag';
import { requireAuth, authErrorResponse, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const { searchParams } = new URL(req.url);
    const detailId = searchParams.get('detail');

    if (detailId) {
      const chunks = await getDocumentChunks(user.id, detailId);
      return Response.json({ chunks });
    }

    const documents = await getAllDocuments(user.id);
    return Response.json({ documents });
  } catch (error) {
    console.error('Get documents error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '获取文档列表失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return Response.json({ error: '缺少文档 ID' }, { status: 400 });
    }

    const deleted = await deleteDocument(user.id, id);
    if (!deleted) {
      return Response.json({ error: '文档不存在' }, { status: 404 });
    }

    return Response.json({ success: true, id });
  } catch (error) {
    console.error('Delete document error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '删除文档失败' }, { status: 500 });
  }
}
