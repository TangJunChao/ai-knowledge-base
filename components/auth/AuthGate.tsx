'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * 登录守卫：包裹需要登录的页面内容。
 * 未登录时跳转到 /login（携带 next 回跳地址）；/login 页本身放行。
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'guest'>('loading');
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    if (pathname === '/login') {
      setState('ok');
      return;
    }
    fetch('/api/auth/me')
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setState('ok');
        } else {
          setState('guest');
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState('guest');
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (state === 'guest') return null; // 正在跳转登录页
  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted">
        加载中...
      </div>
    );
  }
  return <>{children}</>;
}
