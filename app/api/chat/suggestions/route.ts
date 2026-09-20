/**
 * 追问建议 API - 回答完成后生成 2-3 个相关追问（仅当前登录用户）
 *
 * POST /api/chat/suggestions
 * Body: { question: string, answer: string }
 * Response: { suggestions: string[] }
 *
 * 说明：本接口为增强功能，失败/超时返回空数组，前端静默忽略，不影响主回答。
 */

import { NextRequest } from 'next/server';
import { requireAuth, authErrorResponse, AuthError } from '@/lib/auth';
import { generateSuggestions } from '@/lib/suggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = await req.json();
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    const answer = typeof body?.answer === 'string' ? body.answer.trim() : '';

    if (!question) {
      return Response.json({ error: '缺少用户提问' }, { status: 400 });
    }
    if (!answer) {
      return Response.json({ error: '缺少 AI 回答' }, { status: 400 });
    }

    const suggestions = await generateSuggestions(question, answer);
    return Response.json({ suggestions });
  } catch (error) {
    console.error('Suggestions API error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    // 建议属于增强功能：任何错误都返回空列表而非 500，前端无需特殊处理
    return Response.json({ suggestions: [] });
  }
}
