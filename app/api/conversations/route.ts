/**
 * 会话管理 API（仅当前登录用户，多用户隔离）
 *
 * GET  /api/conversations          - 会话列表（按最后活动时间倒序，含消息数/预览）
 * POST /api/conversations          - 新建会话 { title?: string }
 */

import { NextRequest } from 'next/server';
import { listConversations, createConversation } from '@/lib/rag';
import { requireAuth, authErrorResponse, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const conversations = await listConversations(user.id);
    return Response.json({ conversations });
  } catch (error) {
    console.error('List conversations error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '获取会话列表失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    let title: string | undefined;
    try {
      const body = await req.json();
      title = typeof body?.title === 'string' ? body.title : undefined;
    } catch {
      // 空 body 也允许：创建默认"新对话"
    }
    const conversation = await createConversation(user.id, title);
    return Response.json({ conversation }, { status: 201 });
  } catch (error) {
    console.error('Create conversation error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '新建会话失败' }, { status: 500 });
  }
}
