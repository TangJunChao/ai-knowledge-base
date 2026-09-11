'use client';

import { useState, useCallback } from 'react';
import { UploadZone } from '@/components/documents/UploadZone';
import { DocumentList } from '@/components/documents/DocumentList';

export default function DocumentsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUploadSuccess = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">文档管理</h1>
        <p className="text-sm text-muted">
          上传文档构建知识库，系统会自动分块并生成向量索引
        </p>
      </div>

      <div className="mb-6">
        <UploadZone onUploadSuccess={handleUploadSuccess} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">知识库文档</h2>
        </div>
        <DocumentList key={refreshKey} />
      </div>
    </div>
  );
}
