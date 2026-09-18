/**
 * 单条对话历史 API（仅当前登录用户）
 *
 * DELETE /api/history/:id - 删除指定对话记录（仅本人）
 */

import { NextRequest } from 'next/server';
import { deleteChatHistory } from '@/lib/rag';
import { requireAuth, authErrorResponse, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(req);
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少记录 ID' }, { status: 400 });
    }

    await deleteChatHistory(user.id, id);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Delete history error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '删除对话记录失败' }, { status: 500 });
  }
}
