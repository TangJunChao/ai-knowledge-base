/**
 * 认证核心（服务端专用）
 *
 * - 密码哈希：Node 内置 crypto.scrypt（盐 + 时序安全比较），零依赖
 * - 会话令牌：HMAC-SHA256 签名的 JWT（httpOnly Cookie，7 天有效）
 * - 读取用户：从请求 Cookie 解析令牌，返回当前用户
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query } from './db';

export const TOKEN_COOKIE = 'auth_token';
const SESSION_SECONDS = 7 * 24 * 3600; // 7 天

/** 签名密钥：优先 .env 的 AUTH_SECRET；未设置时用内置默认值（本地部署可接受，生产建议配置） */
function secret(): string {
  return process.env.AUTH_SECRET || 'ai-knowledge-base-local-secret';
}

/** 密码哈希：返回 "salt:hash" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** 校验密码（时序安全） */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && timingSafeEqual(test, real);
}

interface TokenPayload {
  sub: string; // user id
  username: string;
  role?: string;
  exp: number; // 过期时间戳（秒）
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

/** 签发 JWT（HS256） */
export function signToken(userId: string, username: string, role?: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      username,
      role,
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    } satisfies TokenPayload)
  );
  const sig = createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** 校验 JWT，返回 payload 或 null */
export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface SessionUser {
  id: string;
  username: string;
  role?: string;
}

/** 从请求 Cookie 解析当前用户；未登录返回 null */
export function getSessionUser(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return { id: payload.sub, username: payload.username, role: payload.role };
}

/** 未登录时抛出的错误（API 统一转为 401） */
export class AuthError extends Error {
  constructor(message = '未登录或登录已过期') {
    super(message);
    this.name = 'AuthError';
  }
}

/** 权限不足时抛出的错误（API 统一转为 403） */
export class ForbiddenError extends Error {
  constructor(message = '需要管理员权限') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** 要求登录，否则抛 AuthError（由路由捕获返回 401） */
export function requireAuth(req: NextRequest): SessionUser {
  const user = getSessionUser(req);
  if (!user) throw new AuthError();
  return user;
}

/** 要求管理员权限：登录 + 数据库角色校验（不信任令牌中的 role），否则抛 ForbiddenError */
export async function requireAdmin(req: NextRequest): Promise<SessionUser> {
  const user = requireAuth(req);
  const rows = await query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [user.id]);
  if (rows.length === 0 || rows[0].role !== 'admin') {
    throw new ForbiddenError();
  }
  return user;
}

/** 把 JWT 写入响应 Cookie */
export function setAuthCookie(res: NextResponse, token: string): void {
  res.cookies.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // 本地部署走 http
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}

/** 清除登录 Cookie */
export function clearAuthCookie(res: NextResponse): void {
  res.cookies.set(TOKEN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/** 供 API 路由统一处理 AuthError 的响应 */
export function authErrorResponse(message?: string): NextResponse {
  return NextResponse.json({ error: message || '未登录或登录已过期' }, { status: 401 });
}

/** 供 API 路由统一处理 ForbiddenError 的响应 */
export function forbiddenErrorResponse(message?: string): NextResponse {
  return NextResponse.json({ error: message || '需要管理员权限' }, { status: 403 });
}
