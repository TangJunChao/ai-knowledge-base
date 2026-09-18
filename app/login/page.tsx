'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      const name = username.trim();
      if (!name || !password) {
        setError('请输入用户名和密码');
        return;
      }
      if (mode === 'register' && password !== confirm) {
        setError('两次输入的密码不一致');
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/auth/${mode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: name, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || '操作失败，请重试');
          return;
        }
        const next = searchParams.get('next') || '/';
        router.replace(next);
        router.refresh();
      } catch {
        setError('网络错误，请重试');
      } finally {
        setLoading(false);
      }
    },
    [mode, username, password, confirm, router, searchParams]
  );

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-surface p-8 shadow-sm">
          <div className="flex flex-col items-center mb-6">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-white text-xl font-bold mb-3">
              KB
            </span>
            <h1 className="text-xl font-semibold">AI 知识库问答系统</h1>
            <p className="text-sm text-muted mt-1">
              {mode === 'login' ? '登录后开始使用' : '创建你的账号'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
            />
            {mode === 'register' && (
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="确认密码"
                autoComplete="new-password"
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
              />
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-60"
            >
              {loading ? '请稍候...' : mode === 'login' ? '登 录' : '注 册'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-muted">
            {mode === 'login' ? (
              <>
                还没有账号？{' '}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="text-primary hover:underline"
                >
                  注册
                </button>
              </>
            ) : (
              <>
                已有账号？{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-primary hover:underline"
                >
                  去登录
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-muted">
          <Link href="/" className="hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
