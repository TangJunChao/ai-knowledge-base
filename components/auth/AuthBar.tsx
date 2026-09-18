'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

interface MeUser {
  id: string;
  username: string;
  role?: string;
}

/** 顶部用户栏：显示当前用户名 + 管理员入口 + 退出登录 */
export function AuthBar() {
  const [user, setUser] = useState<MeUser | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    if (pathname === '/login') {
      setUser(null);
      return;
    }
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 即使请求失败也继续跳转
    }
    setUser(null);
    router.replace('/login');
  }, [router]);

  if (!user) return null;

  const isAdmin = user.role === 'admin';

  return (
    <div className="flex items-center gap-2">
      {isAdmin && (
        <Link
          href="/admin/users"
          className="px-2.5 py-1 rounded-lg text-sm text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
        >
          用户管理
        </Link>
      )}
      <span className="text-sm text-muted max-w-32 truncate">{user.username}</span>
      <button
        onClick={handleLogout}
        className="px-2.5 py-1 rounded-lg text-sm text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
      >
        退出
      </button>
    </div>
  );
}
