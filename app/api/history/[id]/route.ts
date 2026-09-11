/**
 * 单条对话历史 API
 *
 * DELETE /api/history/:id - 删除指定对话记录
 */

import { deleteChatHistory } from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少记录 ID' }, { status: 400 });
    }

    await deleteChatHistory(id);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Delete history error:', error);
    return Response.json(
      { error: '删除对话记录失败' },
      { status: 500 }
    );
  }
}
