/**
 * 会话管理 API
 *
 * GET  /api/conversations          - 会话列表（按最后活动时间倒序，含消息数/预览）
 * POST /api/conversations          - 新建会话 { title?: string }
 */

import {
  listConversations,
  createConversation,
} from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const conversations = await listConversations();
    return Response.json({ conversations });
  } catch (error) {
    console.error('List conversations error:', error);
    return Response.json(
      { error: '获取会话列表失败' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    let title: string | undefined;
    try {
      const body = await req.json();
      title = typeof body?.title === 'string' ? body.title : undefined;
    } catch {
      // 空 body 也允许：创建默认"新对话"
    }
    const conversation = await createConversation(title);
    return Response.json({ conversation }, { status: 201 });
  } catch (error) {
    console.error('Create conversation error:', error);
    return Response.json(
      { error: '新建会话失败' },
      { status: 500 }
    );
  }
}
