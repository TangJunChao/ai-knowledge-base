import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 知识库问答系统',
  description: '基于 RAG 的知识库问答系统，支持文档上传和智能问答',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-border bg-surface">
            <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 font-semibold text-lg">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-white text-sm font-bold">
                  KB
                </span>
                <span>AI 知识库</span>
              </Link>
              <nav className="flex items-center gap-1">
                <Link
                  href="/chat"
                  className="px-3 py-1.5 rounded-lg text-sm hover:bg-surface-hover transition-colors"
                >
                  问答
                </Link>
                <Link
                  href="/history"
                  className="px-3 py-1.5 rounded-lg text-sm hover:bg-surface-hover transition-colors"
                >
                  历史记录
                </Link>
                <Link
                  href="/documents"
                  className="px-3 py-1.5 rounded-lg text-sm hover:bg-surface-hover transition-colors"
                >
                  文档管理
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
