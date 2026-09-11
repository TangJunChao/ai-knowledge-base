'use client';

interface Source {
  title: string;
  similarity: number;
}

interface SourceCardProps {
  sources: Source[];
}

export function SourceCard({ sources }: SourceCardProps) {
  if (!sources || sources.length === 0) {
    return (
      <div className="text-xs text-muted italic mt-2">
        未找到相关参考文档
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="text-xs text-muted mb-2">参考来源:</div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-hover text-xs"
            title={`相似度: ${(source.similarity * 100).toFixed(1)}%`}
          >
            <svg
              className="w-3 h-3 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="max-w-[200px] truncate">{source.title}</span>
            <span className="text-muted">
              {(source.similarity * 100).toFixed(0)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
