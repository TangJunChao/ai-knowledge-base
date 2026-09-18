/**
 * 管理员 - 重置用户密码（仅管理员）
 *
 * POST /api/admin/users/:id/reset-password  { newPassword: string }
 */

import { NextRequest } from 'next/server';
import { requireAdmin, authErrorResponse, forbiddenErrorResponse, AuthError, ForbiddenError, hashPassword } from '@/lib/auth';
import { execute } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin(req);
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少用户 ID' }, { status: 400 });
    }

    const body = await req.json();
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 6) {
      return Response.json({ error: '新密码至少 6 位' }, { status: 400 });
    }

    const hash = hashPassword(newPassword);
    const affected = await execute(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [hash, id]
    );
    if (affected === 0) {
      return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Admin reset password error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    if (error instanceof ForbiddenError) return forbiddenErrorResponse();
    return Response.json({ error: '重置密码失败' }, { status: 500 });
  }
}
