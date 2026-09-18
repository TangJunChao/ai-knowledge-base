/**
 * 管理员 - 删除用户（仅管理员）
 *
 * DELETE /api/admin/users/:id
 * 级联删除该用户的所有文档 / 会话 / 历史记录（外键 ON DELETE CASCADE）。
 * 不允许删除自己，也不允许删除管理员账号（保证系统始终有管理员）。
 */

import { NextRequest } from 'next/server';
import { requireAdmin, authErrorResponse, forbiddenErrorResponse, AuthError, ForbiddenError } from '@/lib/auth';
import { query, execute } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = params;
    if (!id) {
      return Response.json({ error: '缺少用户 ID' }, { status: 400 });
    }
    if (id === admin.id) {
      return Response.json({ error: '不能删除自己的账号' }, { status: 400 });
    }

    const rows = await query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
    if (rows.length === 0) {
      return Response.json({ error: '用户不存在' }, { status: 404 });
    }
    if (rows[0].role === 'admin') {
      return Response.json({ error: '不能删除管理员账号' }, { status: 400 });
    }

    await execute(`DELETE FROM users WHERE id = $1`, [id]);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Admin delete user error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    if (error instanceof ForbiddenError) return forbiddenErrorResponse();
    return Response.json({ error: '删除用户失败' }, { status: 500 });
  }
}
