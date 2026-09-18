/**
 * 数据库初始化脚本（幂等，供 Docker 容器启动时自动执行）
 *
 * 与 scripts/migrate.js 的区别：
 * - migrate.js：DROP 后重建（本地开发用）
 * - init-db.js：CREATE IF NOT EXISTS，不删任何已有数据（生产/容器安全）
 *
 * 运行: node scripts/init-db.js
 * 会自动等待数据库就绪（最多约 80 秒）再建表。
 */

const { Pool } = require('pg');

const EMBEDDING_DIM = 512;

const schema = `
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 用户表（登录与多用户隔离）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 文档表
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  source_type VARCHAR(50) NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  table_data JSONB,
  chunk_count INT NOT NULL DEFAULT 0,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 文档分块表（带向量列）
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INT NOT NULL,
  embedding vector(${EMBEDDING_DIM}),
  token_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 会话表（多会话管理）
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL DEFAULT '新对话',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 对话历史表（归属会话）
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  stat_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 向量索引（HNSW 加速相似度搜索）
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- 文档 ID 索引
CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
  ON document_chunks(document_id);

-- 文档创建时间索引
CREATE INDEX IF NOT EXISTS documents_created_at_idx
  ON documents(created_at DESC);

-- 对话历史创建时间索引
CREATE INDEX IF NOT EXISTS chat_history_created_at_idx
  ON chat_history(created_at DESC);

-- 会话更新时间索引
CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
  ON conversations(updated_at DESC);

-- 历史记录按会话查询索引
CREATE INDEX IF NOT EXISTS chat_history_conversation_id_idx
  ON chat_history(conversation_id, created_at);

-- 用户隔离查询索引
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);
CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id);
CREATE INDEX IF NOT EXISTS chat_history_user_id_idx ON chat_history(user_id);
`;

/** 等待数据库可用（最多 maxAttempts 次，每次间隔 2 秒） */
async function waitForDb(connectionString, maxAttempts = 40) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
      await pool.query('SELECT 1');
      await pool.end();
      console.log('数据库连接成功');
      return;
    } catch (err) {
      console.log(`等待数据库就绪 (${i}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('等待数据库连接超时，请检查数据库服务');
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  await waitForDb(connectionString);

  const pool = new Pool({ connectionString, max: 1 });
  try {
    console.log('执行数据库初始化...');
    await pool.query(schema);
    console.log('数据库初始化完成');
  } catch (err) {
    console.error('数据库初始化失败:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
