/**
 * 历史迁移：用「行级分块」逻辑重建所有已入库文档的 document_chunks。
 *
 * 背景：旧分块在表格文本的任意空格处断块，把「水费(12月）:」和金额「87.00」
 * 切到两个块，导致检索片段残缺。本脚本读取 documents.content（原始解析全文），
 * 用新逻辑重新分块并重新生成向量，覆盖 document_chunks。
 *
 * 用法：node scripts/rechunk-documents.js
 * 注意：分块逻辑须与 lib/chunking.ts 保持一致（本脚本为一次性迁移工具，内联了该逻辑）。
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ---------- 加载 .env ----------
const envPath = path.join(__dirname, '..', '.env');
const envRaw = fs.readFileSync(envPath, 'utf-8');
const getEnv = (key) => {
  const m = envRaw.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
};
const DATABASE_URL = getEnv('DATABASE_URL');
const HF_ENDPOINT = getEnv('HF_ENDPOINT');
const CHUNK_SIZE = parseInt(getEnv('CHUNK_SIZE') || '800', 10);
const CHUNK_OVERLAP = parseInt(getEnv('CHUNK_OVERLAP') || '200', 10);

if (!DATABASE_URL) {
  console.error('未找到 DATABASE_URL，请检查 .env');
  process.exit(1);
}

// ---------- 分块逻辑（与 lib/chunking.ts 一致）----------
function estimateTokens(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const others = text.length - chineseChars - englishWords;
  return Math.ceil(chineseChars + englishWords * 1.3 + others * 0.5);
}

function keepOverlap(buffer, overlap) {
  if (buffer.length <= overlap) return buffer;
  const tail = buffer.slice(-overlap);
  const nl = tail.indexOf('\n');
  if (nl !== -1 && nl < tail.length - 1) return tail.slice(nl + 1);
  return tail;
}

function chunkLongLine(line, chunkSize, chunkOverlap) {
  const out = [];
  let startIndex = 0;
  while (startIndex < line.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex >= line.length) {
      out.push(line.slice(startIndex));
      break;
    }
    let breakPoint = endIndex;
    const lookBack = Math.min(100, chunkSize);
    const sentenceEnd = line.lastIndexOf('。', endIndex);
    const pipe = line.lastIndexOf(' | ', endIndex);
    const space = line.lastIndexOf(' ', endIndex);
    const candidates = [sentenceEnd, pipe, space].filter(
      (pos) => pos > startIndex + chunkSize - lookBack
    );
    if (candidates.length > 0) breakPoint = Math.max(...candidates) + 1;
    out.push(line.slice(startIndex, breakPoint));
    startIndex = breakPoint - chunkOverlap;
    if (startIndex < 0) startIndex = 0;
    if (startIndex >= endIndex - chunkOverlap) startIndex = endIndex;
  }
  return out;
}

function chunkText(text, chunkSize, chunkOverlap) {
  if (!text || text.trim().length === 0) return [];
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const lines = cleaned.split('\n');
  const chunks = [];
  let buffer = '';
  let chunkIndex = 0;
  const pushChunk = (content) => {
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      chunks.push({ content: trimmed, chunkIndex, tokenCount: estimateTokens(trimmed) });
      chunkIndex++;
    }
  };
  for (const line of lines) {
    if (line.length >= chunkSize) {
      pushChunk(buffer);
      for (const sub of chunkLongLine(line, chunkSize, chunkOverlap)) pushChunk(sub);
      buffer = '';
      continue;
    }
    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (buffer && candidate.length > chunkSize) {
      pushChunk(buffer);
      buffer = keepOverlap(buffer, chunkOverlap);
      buffer = buffer ? `${buffer}\n${line}` : line;
    } else {
      buffer = candidate;
    }
  }
  pushChunk(buffer);
  return chunks;
}

// ---------- 向量化（与 lib/embeddings.ts 一致）----------
const { pipeline, env } = require('@xenova/transformers');
env.allowRemoteModels = true;
env.remoteHost = HF_ENDPOINT || 'https://hf-mirror.com';
env.localModelPath = './.models';

let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
  }
  return embedderPromise;
}

async function generateEmbeddings(texts) {
  if (texts.length === 0) return [];
  const extractor = await getEmbedder();
  const results = [];
  for (const t of texts) {
    const output = await extractor(t, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

function toPgVector(embedding) {
  return `[${embedding.join(',')}]`;
}

// ---------- 主流程 ----------
const pool = new Pool({ connectionString: DATABASE_URL });

(async () => {
  const docs = await pool.query(
    `SELECT id, title, content FROM documents ORDER BY created_at ASC`
  );
  console.log(`共 ${docs.rows.length} 篇文档，开始重新分块 + 向量化...`);

  for (const doc of docs.rows) {
    const chunks = chunkText(doc.content, CHUNK_SIZE, CHUNK_OVERLAP);
    if (chunks.length === 0) {
      console.log(`跳过「${doc.title}」（分块为空）`);
      continue;
    }

    const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM document_chunks WHERE document_id = $1', [doc.id]);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await client.query(
          `INSERT INTO document_chunks (document_id, content, chunk_index, embedding, token_count)
           VALUES ($1, $2, $3, $4::vector, $5)`,
          [doc.id, chunk.content, chunk.chunkIndex, toPgVector(embeddings[i]), chunk.tokenCount]
        );
      }
      await client.query(
        `UPDATE documents SET chunk_count = $1 WHERE id = $2`,
        [chunks.length, doc.id]
      );
      await client.query('COMMIT');
      console.log(`✅ 「${doc.title}」: ${chunks.length} 块已重建`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('全部完成');
  await pool.end();
})().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
