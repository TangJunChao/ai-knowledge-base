/**
 * 单个会话 API
 *
 * GET    /api/conversations/:id  - 会话详情（基本信息 + 全部消息，按时间正序）
 * PATCH  /api/conversations/:id  - 重命名 { title: string }
 * DELETE /api/conversations/:id  - 删除会话（级联删除其下所有消息）
 */

import {
  getConversationWithMessages,
  renameConversation,
  deleteConversation,
} from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少会话 ID' }, { status: 400 });
    }
    const data = await getConversationWithMessages(id);
    if (!data) {
      return Response.json({ error: '会话不存在' }, { status: 404 });
    }
    return Response.json(data);
  } catch (error) {
    console.error('Get conversation error:', error);
    return Response.json(
      { error: '获取会话详情失败' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return Response.json({ error: '标题不能为空' }, { status: 400 });
    }
    await renameConversation(id, title);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Rename conversation error:', error);
    return Response.json(
      { error: '重命名会话失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少会话 ID' }, { status: 400 });
    }
    await deleteConversation(id);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return Response.json(
      { error: '删除会话失败' },
      { status: 500 }
    );
  }
}
