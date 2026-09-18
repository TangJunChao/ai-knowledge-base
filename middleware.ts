/**
 * 登录守卫（服务端 middleware）
 *
 * 未登录访问受保护页面时，直接在服务端 302 重定向到 /login，
 * 页面不会渲染、不会发起受保护接口请求，浏览器控制台也就不会出现
 * 401 网络错误（页面内不再有 fetch /api/auth/me 的 401）。
 *
 * 业务 API（/api/*）不在此拦截，仍由各路由的 requireAuth 兜底返回 401。
 * 验证逻辑与 lib/auth.ts 的 JWT（HS256 / base64url）保持一致，
 * 此处用 Web Crypto 实现以兼容 Edge runtime。
 */

import { NextRequest, NextResponse } from 'next/server';

const TOKEN_COOKIE = 'auth_token';

function secret(): string {
  return process.env.AUTH_SECRET || 'ai-knowledge-base-local-secret';
}

/** base64url → base64（补齐 padding，供 atob 使用） */
function b64urlToB64(s: string): string {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4 !== 0) b += '=';
  return b;
}

/** ArrayBuffer → base64url */
function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 用 Web Crypto 校验 JWT 签名与有效期（与 lib/auth.ts 兼容） */
async function verifyToken(token: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, body, sig] = parts;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (bufToB64url(mac) !== sig) return false;
    const payload = JSON.parse(atob(b64urlToB64(body))) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const valid = token ? await verifyToken(token) : false;

  // 已登录：全部放行
  if (valid) return NextResponse.next();

  // 未登录：登录页与静态资源放行
  if (
    pathname === '/login' ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // 未登录访问受保护页面：重定向到登录页（携带回跳地址）
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/', '/chat/:path*', '/history/:path*', '/documents/:path*', '/admin/:path*'],
};
