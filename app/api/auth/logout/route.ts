import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/logout */
export async function POST() {
  const res = NextResponse.json({ success: true });
  clearAuthCookie(res);
  return res;
}
