import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me 返回当前登录用户（角色从数据库读取，保证准确） */
export async function GET(req: NextRequest) {
  const session = getSessionUser(req);
  if (!session) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const rows = await query<{ id: string; username: string; role: string }>(
    `SELECT id, username, role FROM users WHERE id = $1`,
    [session.id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: '用户不存在' }, { status: 401 });
  }
  const user = rows[0];
  return NextResponse.json({ user: { id: user.id, username: user.username, role: user.role } });
}
