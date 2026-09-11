import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">AI 知识库问答系统</h1>
        <p className="text-muted text-lg">
          上传文档，构建知识库，基于 RAG 技术实现智能问答
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/chat"
          className="group block p-6 rounded-2xl border border-border bg-surface hover:border-primary hover:shadow-lg transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
            智能问答
          </h2>
          <p className="text-sm text-muted">
            基于已上传的文档进行问答，AI 会从知识库中检索相关内容并给出引用来源
          </p>
        </Link>

        <Link
          href="/history"
          className="group block p-6 rounded-2xl border border-border bg-surface hover:border-primary hover:shadow-lg transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
            历史记录
          </h2>
          <p className="text-sm text-muted">
            查看过往问答记录，支持搜索和筛选，快速回顾之前的提问与回答
          </p>
        </Link>

        <Link
          href="/documents"
          className="group block p-6 rounded-2xl border border-border bg-surface hover:border-primary hover:shadow-lg transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
            文档管理
          </h2>
          <p className="text-sm text-muted">
            上传 PDF、Word、Markdown、TXT 等文档，自动分块并生成向量索引
          </p>
        </Link>
      </div>

      <div className="mt-16">
        <h3 className="text-lg font-semibold mb-4">系统架构</h3>
        <div className="bg-surface border border-border rounded-xl p-6 text-sm leading-relaxed">
          <pre className="whitespace-pre-wrap text-muted">{`用户提问
  ↓
生成问题向量 (Embedding)
  ↓
向量检索 (pgvector cosine similarity)
  ↓
取回 Top-K 相关文档片段
  ↓
组装 RAG Prompt (上下文 + 问题)
  ↓
LLM 流式生成回答
  ↓
展示回答 + 引用来源`}</pre>
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: '前端', value: 'Next.js + TypeScript + Tailwind CSS' },
          { label: 'AI', value: 'Vercel AI SDK + OpenAI' },
          { label: '存储', value: 'PostgreSQL + pgvector' },
        ].map((item) => (
          <div key={item.label} className="p-4 rounded-xl bg-surface border border-border">
            <div className="text-xs text-muted mb-1">{item.label}</div>
            <div className="text-sm font-medium">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
