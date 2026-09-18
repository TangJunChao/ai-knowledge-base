'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface User {
  id: string;
  username: string;
  role: string;
  created_at: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [meId, setMeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 当前用户 id（隐藏自己行的删除按钮）
      fetch('/api/auth/me')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.user?.id) setMeId(d.user.id);
        })
        .catch(() => {});
      const res = await fetch('/api/admin/users');
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleReset = useCallback(async () => {
    if (!resetTarget || newPassword.length < 6) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`重置失败：${data?.error || '未知错误'}`);
        return;
      }
      setMsg(`已重置「${resetTarget.username}」的密码`);
      setResetTarget(null);
      setNewPassword('');
    } finally {
      setBusy(false);
    }
  }, [resetTarget, newPassword]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`删除失败：${data?.error || '未知错误'}`);
        return;
      }
      setMsg(`已删除用户「${deleteTarget.username}」（其文档、会话、历史记录一并删除）`);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }, [deleteTarget]);

  // 可被选中的用户（管理员与自己不可选/不可删）
  const deletableUsers = users.filter((u) => u.role !== 'admin' && u.id !== meId);
  const allSelected =
    deletableUsers.length > 0 && deletableUsers.every((u) => selected.has(u.id));

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(deletableUsers.map((u) => u.id)));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBatchDelete = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/users/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`批量删除失败：${data?.error || '未知错误'}`);
        return;
      }
      setMsg(
        `已删除 ${data.deleted} 个用户` +
          (data.skipped ? `，跳过 ${data.skipped} 个（管理员/自己）` : '')
      );
      setSelected(new Set());
      setBatchDeleteOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }, [selected, load]);

  if (forbidden) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-lg font-semibold mb-2">无权限访问</h1>
        <p className="text-sm text-muted mb-4">该页面仅管理员可用。</p>
        <Link href="/" className="text-sm text-primary hover:underline">
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">用户管理</h1>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => setBatchDeleteOpen(true)}
              className="px-3 py-1.5 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              批量删除（{selected.size}）
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm hover:bg-surface-hover text-muted hover:text-foreground transition-colors disabled:opacity-40"
          >
            刷新
          </button>
        </div>
      </div>

      {msg && (
        <div className="mb-4 text-sm bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2">
          {msg}
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-hover/50 text-left text-xs text-muted">
              <th className="px-4 py-2.5 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={deletableUsers.length === 0}
                  title="全选可删除用户"
                />
              </th>
              <th className="px-4 py-2.5 font-medium">用户名</th>
              <th className="px-4 py-2.5 font-medium">角色</th>
              <th className="px-4 py-2.5 font-medium">注册时间</th>
              <th className="px-4 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted">
                  加载中...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted">
                  暂无用户
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                      disabled={u.role === 'admin' || u.id === meId}
                      title={
                        u.role === 'admin' || u.id === meId ? '管理员/自己不可删除' : '选择'
                      }
                    />
                  </td>
                  <td className="px-4 py-2.5">{u.username}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        u.role === 'admin'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-surface-hover text-muted'
                      }`}
                    >
                      {u.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          setResetTarget(u);
                          setNewPassword('');
                          setMsg('');
                        }}
                        className="px-2.5 py-1 rounded-lg text-sm text-primary hover:bg-primary/10 transition-colors"
                      >
                        重置密码
                      </button>
                      {u.id !== meId && (
                        <button
                          onClick={() => {
                            setDeleteTarget(u);
                            setMsg('');
                          }}
                          className="px-2.5 py-1 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 重置密码弹窗 */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <h2 className="text-base font-semibold mb-1">
              重置「{resetTarget.username}」的密码
            </h2>
            <p className="text-xs text-muted mb-4">重置后该用户需使用新密码登录。</p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="输入新密码（至少 6 位）"
              autoFocus
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setResetTarget(null)}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm text-muted hover:bg-surface-hover transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleReset}
                disabled={busy || newPassword.length < 6}
                className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-40"
              >
                {busy ? '提交中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除用户确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <h2 className="text-base font-semibold mb-1">
              删除用户「{deleteTarget.username}」？
            </h2>
            <p className="text-xs text-muted mb-4">
              该用户的全部文档、会话与历史记录将被永久删除，且不可恢复。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm text-muted hover:bg-surface-hover transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-40"
              >
                {busy ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量删除确认弹窗 */}
      {batchDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <h2 className="text-base font-semibold mb-1">
              批量删除 {selected.size} 个用户？
            </h2>
            <p className="text-xs text-muted mb-4">
              这些用户的全部文档、会话与历史记录将被永久删除，且不可恢复。管理员账号与自己的账号不会受影响。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setBatchDeleteOpen(false)}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm text-muted hover:bg-surface-hover transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-40"
              >
                {busy ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
