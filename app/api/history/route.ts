/**
 * 对话历史 API
 *
 * GET /api/history - 获取对话历史列表
 * DELETE /api/history - 清空所有对话历史
 */

import { getChatHistory, clearAllChatHistory } from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const history = await getChatHistory(50);
    return Response.json({ history });
  } catch (error) {
    console.error('Get history error:', error);
    return Response.json(
      { error: '获取对话历史失败' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await clearAllChatHistory();
    return Response.json({ success: true });
  } catch (error) {
    console.error('Clear history error:', error);
    return Response.json(
      { error: '清空对话历史失败' },
      { status: 500 }
    );
  }
}
