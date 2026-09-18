/**
 * 单个会话 API（仅当前登录用户，防止误操作他人会话）
 *
 * GET    /api/conversations/:id  - 会话详情（基本信息 + 全部消息，按时间正序）
 * PATCH  /api/conversations/:id  - 重命名 { title: string }
 * DELETE /api/conversations/:id  - 删除会话（级联删除其下所有消息）
 */

import { NextRequest } from 'next/server';
import {
  getConversationWithMessages,
  renameConversation,
  deleteConversation,
} from '@/lib/rag';
import { requireAuth, authErrorResponse, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(req);
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少会话 ID' }, { status: 400 });
    }
    const data = await getConversationWithMessages(user.id, id);
    if (!data) {
      return Response.json({ error: '会话不存在' }, { status: 404 });
    }
    return Response.json(data);
  } catch (error) {
    console.error('Get conversation error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '获取会话详情失败' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(req);
    const { id } = params;
    const body = await req.json();
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return Response.json({ error: '标题不能为空' }, { status: 400 });
    }
    const renamed = await renameConversation(user.id, id, title);
    if (!renamed) {
      return Response.json({ error: '会话不存在' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error('Rename conversation error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '重命名会话失败' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(req);
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少会话 ID' }, { status: 400 });
    }
    const deleted = await deleteConversation(user.id, id);
    if (!deleted) {
      return Response.json({ error: '会话不存在' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error('Delete conversation error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    return Response.json({ error: '删除会话失败' }, { status: 500 });
  }
}
