/**
 * 数据库迁移脚本
 * 运行: node scripts/migrate.js
 *
 * 前置条件:
 * 1. 安装并启动 PostgreSQL
 * 2. 创建数据库: CREATE DATABASE ai_knowledge_base;
 * 3. 安装 pgvector 扩展: CREATE EXTENSION IF NOT EXISTS vector;
 * 4. 配置 .env 中的 DATABASE_URL
 */

const { Pool } = require('pg');

const EMBEDDING_DIM = 512;

const schema = `
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 删除旧表（如需保留数据请注释掉）
DROP TABLE IF EXISTS chat_history CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS document_chunks CASCADE;
DROP TABLE IF EXISTS documents CASCADE;

-- 文档表
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INT NOT NULL,
  embedding vector(${EMBEDDING_DIM}),
  token_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 会话表（多会话管理）
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL DEFAULT '新对话',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 对话历史表（归属会话）
CREATE TABLE chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  stat_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 向量索引（使用 HNSW 加速相似度搜索，适合小数据量）
CREATE INDEX document_chunks_embedding_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- 文档 ID 索引
CREATE INDEX document_chunks_document_id_idx
  ON document_chunks(document_id);

-- 文档创建时间索引
CREATE INDEX documents_created_at_idx
  ON documents(created_at DESC);

-- 对话历史创建时间索引
CREATE INDEX chat_history_created_at_idx
  ON chat_history(created_at DESC);

-- 会话更新时间索引
CREATE INDEX conversations_updated_at_idx
  ON conversations(updated_at DESC);

-- 历史记录按会话查询索引
CREATE INDEX chat_history_conversation_id_idx
  ON chat_history(conversation_id, created_at);
`;

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL is not set. Please configure your .env file.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();

    console.log('Running migrations...');
    await client.query(schema);

    console.log('Migration completed successfully!');
    console.log(`Tables created with embedding dimension: ${EMBEDDING_DIM}`);

    client.release();
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error('\nMake sure PostgreSQL is running and pgvector extension is installed.');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
