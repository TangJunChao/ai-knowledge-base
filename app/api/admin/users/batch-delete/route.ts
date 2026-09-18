/**
 * 管理员 - 批量删除用户（仅管理员）
 *
 * POST /api/admin/users/batch-delete  { ids: string[] }
 * 自动排除：当前管理员自己、其他管理员账号。
 * 返回实际删除数与跳过数（跳过的为管理员账号，前端自行过滤自己）。
 */

import { NextRequest } from 'next/server';
import { requireAdmin, authErrorResponse, forbiddenErrorResponse, AuthError, ForbiddenError } from '@/lib/auth';
import { query, execute } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json();
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
      : [];

    if (ids.length === 0) {
      return Response.json({ error: '请选择要删除的用户' }, { status: 400 });
    }

    // 排除自己与管理员账号
    const targetIds = ids.filter((id: string) => id !== admin.id);
    if (targetIds.length === 0) {
      return Response.json({ error: '不能删除自己的账号' }, { status: 400 });
    }

    const rows = await query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE id = ANY($1::uuid[])`,
      [targetIds]
    );
    const adminIds = new Set(rows.filter((r) => r.role === 'admin').map((r) => r.id));
    const deletable = targetIds.filter((id: string) => !adminIds.has(id));

    if (deletable.length === 0) {
      return Response.json({ error: '所选用户均为管理员账号，无法删除' }, { status: 400 });
    }

    // 实际删除的行数（不存在的 ID 不计入）
    const deletedCount = await execute(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      deletable,
    ]);

    return Response.json({
      success: true,
      deleted: deletedCount,
      // 跳过 = 提交数中未删除的（管理员账号 / 不存在的 ID），自己已在 targetIds 之外
      skipped: targetIds.length - deletedCount,
    });
  } catch (error) {
    console.error('Admin batch delete users error:', error);
    if (error instanceof AuthError) return authErrorResponse();
    if (error instanceof ForbiddenError) return forbiddenErrorResponse();
    return Response.json({ error: '批量删除用户失败' }, { status: 500 });
  }
}
