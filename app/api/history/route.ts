/**
 * 对话历史 API（仅当前登录用户，多用户隔离）
 *
 * GET /api/history - 获取当前用户的对话历史列表
 * DELETE /api/history - 清空当前用户的对话历史
 */

import { NextRequest } from 'next/server';
import { getChatHistory, clearAllChatHistory } from '@/lib/rag';
import { requireAuth, authErrorResponse, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const history = await getChatHistory(user.id, 50);
    return Response.json({ history });
  } catch (error) {
    console.error('Get history error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '获取对话历史失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = requireAuth(req);
    await clearAllChatHistory(user.id);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Clear history error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '清空对话历史失败' }, { status: 500 });
  }
}
