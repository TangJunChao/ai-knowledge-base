import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword, signToken, setAuthCookie, getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/register { username, password } */
export async function POST(req: NextRequest) {
  try {
    // 已登录则直接返回当前用户（幂等）
    const logged = getSessionUser(req);
    if (logged) {
      return NextResponse.json({ user: logged });
    }

    const body = await req.json();
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用户名需为 2-20 位字母、数字、下划线或中文' },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
    }

    const dup = await query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username]);
    if (dup.length > 0) {
      return NextResponse.json({ error: '用户名已被占用' }, { status: 409 });
    }

    const hash = hashPassword(password);
    const rows = await query<{ id: string; username: string }>(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username`,
      [username, hash]
    );
    const user = rows[0];
    const token = signToken(user.id, user.username, 'user');
    const res = NextResponse.json({ user: { id: user.id, username: user.username, role: 'user' } });
    setAuthCookie(res, token);
    return res;
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: '注册失败' }, { status: 500 });
  }
}
