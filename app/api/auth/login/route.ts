import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword, signToken, setAuthCookie, getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/login { username, password } */
export async function POST(req: NextRequest) {
  try {
    const logged = getSessionUser(req);
    if (logged) {
      return NextResponse.json({ user: logged });
    }

    const body = await req.json();
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
    }

    const rows = await query<{ id: string; username: string; password_hash: string; role: string }>(
      `SELECT id, username, password_hash, role FROM users WHERE username = $1`,
      [username]
    );
    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const user = rows[0];
    const token = signToken(user.id, user.username, user.role);
    const res = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role } });
    setAuthCookie(res, token);
    return res;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: '登录失败' }, { status: 500 });
  }
}
