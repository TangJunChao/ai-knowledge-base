/**
 * 文档管理 API
 *
 * GET    /api/documents        - 获取文档列表
 * DELETE /api/documents?id=xxx - 删除文档
 */

import { NextRequest } from 'next/server';
import { getAllDocuments, deleteDocument, getDocumentChunks } from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const detailId = searchParams.get('detail');

    if (detailId) {
      const chunks = await getDocumentChunks(detailId);
      return Response.json({ chunks });
    }

    const documents = await getAllDocuments();
    return Response.json({ documents });
  } catch (error) {
    console.error('Get documents error:', error);
    return Response.json(
      { error: '获取文档列表失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return Response.json({ error: '缺少文档 ID' }, { status: 400 });
    }

    await deleteDocument(id);

    return Response.json({ success: true, id });
  } catch (error) {
    console.error('Delete document error:', error);
    return Response.json(
      { error: '删除文档失败' },
      { status: 500 }
    );
  }
}
