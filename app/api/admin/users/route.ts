/**
 * 管理员 - 用户管理 API（仅管理员）
 *
 * GET /api/admin/users - 用户列表（id / 用户名 / 角色 / 注册时间）
 */

import { NextRequest } from 'next/server';
import { requireAdmin, authErrorResponse, forbiddenErrorResponse, AuthError, ForbiddenError } from '@/lib/auth';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const users = await query<{ id: string; username: string; role: string; created_at: string }>(
      `SELECT id, username, role, created_at FROM users ORDER BY created_at ASC`
    );
    return Response.json({ users });
  } catch (error) {
    console.error('Admin list users error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    if (error instanceof ForbiddenError) return forbiddenErrorResponse();
    return Response.json({ error: '获取用户列表失败' }, { status: 500 });
  }
}
