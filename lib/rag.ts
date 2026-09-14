/**
 * RAG (Retrieval-Augmented Generation) 核心逻辑
 *
 * 流程:
 * 1. 用户提问 -> 生成问题向量
 * 2. 向量搜索 -> 找到最相关的文档片段
 * 3. 组装 Prompt -> 把检索结果放入上下文
 * 4. 调用 LLM -> 生成回答
 */

import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { query, withTransaction, DocumentRecord, ChunkRecord } from './db';
import { generateEmbedding, toPgVector, generateEmbeddings } from './embeddings';
import { chunkText } from './chunking';
import type { StatsResult, LatestRecordResult } from './statistics';
import { ruleBasedRewrite } from './rewrite';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';
const TOP_K = parseInt(process.env.TOP_K || '5', 10);
/** 关键词检索额外补充的片段数 */
const KEYWORD_TOP_K = parseInt(process.env.KEYWORD_TOP_K || '15', 10);
/** 送入模型的最大片段数（向量 + 关键词去重后） */
const MAX_CONTEXT_CHUNKS = parseInt(process.env.MAX_CONTEXT_CHUNKS || '25', 10);

export interface SearchResult {
  content: string;
  documentTitle: string;
  chunkIndex: number;
  similarity: number;
  documentId: string;
}

export interface RagContext {
  query: string;
  results: SearchResult[];
}

const SYSTEM_PROMPT = `你是一个专业的知识库问答助手。请根据提供的参考资料回答用户的问题。

规则:
1. 只基于参考资料中的内容回答问题，不要编造信息
2. 如果参考资料中没有相关信息，请明确说明"根据知识库中的资料，我无法回答这个问题"
3. 回答时请引用来源，格式为 [来源: 文档标题]
4. 如果多个来源都相关，请综合所有来源的信息
5. 涉及数据、表格、清单类问题时，务必逐条完整列出，不要省略、不要用"等""以此类推"概括
6. 使用 Markdown 格式输出，表格类数据优先用 Markdown 表格呈现`;

interface ChunkRow {
  id: string;
  content: string;
  chunk_index: number;
  document_id: string;
  title: string;
  similarity: number;
}

const CHUNK_SELECT = `SELECT
   dc.id,
   dc.content,
   dc.chunk_index,
   dc.document_id,
   d.title,
   1 - (dc.embedding <=> $1::vector) AS similarity
 FROM document_chunks dc
 JOIN documents d ON d.id = dc.document_id
 WHERE dc.embedding IS NOT NULL`;

const VECTOR_SQL = `${CHUNK_SELECT}
 ORDER BY dc.embedding <=> $1::vector
 LIMIT $2`;

const KEYWORD_SQL = `${CHUNK_SELECT}
   AND dc.content ILIKE ANY($3::text[])
 ORDER BY dc.embedding <=> $1::vector
 LIMIT $2`;

/**
 * 从查询中提取适合精确匹配的字面编号（如 A101、C1C2、609）。
 *
 * 表格数据里各行结构高度雷同（同样的字段名、大量 0.00），纯向量检索的
 * 相似度会被压缩在很窄的区间内，靠向量很难把"某个铺位/编号"的记录全部找回。
 * 这类编号是精确字符串，用关键词匹配反而准得多。
 */
export function extractLiteralTokens(userQuery: string): string[] {
  const tokens = new Set<string>();

  // 含字母的编号：A101、A604、C1C2、A4A5
  for (const m of userQuery.matchAll(/[A-Za-z]{1,3}\d{2,}[A-Za-z0-9]*/g)) {
    tokens.add(m[0]);
  }

  // 2~3 位纯数字编号（如 609、610），排除 4 位年份
  for (const m of userQuery.matchAll(/\b\d{2,3}\b/g)) {
    tokens.add(m[0]);
  }

  return [...tokens].filter((t) => t.length >= 2).slice(0, 5);
}

/**
 * 混合检索：向量相似度 + 字面编号关键词
 */
export async function retrieveContext(
  userQuery: string,
  topK: number = TOP_K
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(userQuery);
  const vectorStr = toPgVector(queryEmbedding);

  // 1. 向量检索
  const vectorResults = await query<ChunkRow>(VECTOR_SQL, [vectorStr, topK]);

  // 2. 关键词检索：把查询中的编号/铺位号精确匹配回来
  const tokens = extractLiteralTokens(userQuery);
  let keywordResults: ChunkRow[] = [];
  if (tokens.length > 0) {
    const patterns = tokens.map((t) => `%${t}%`);
    try {
      keywordResults = await query<ChunkRow>(KEYWORD_SQL, [
        vectorStr,
        KEYWORD_TOP_K,
        patterns,
      ]);
    } catch (error) {
      // 关键词检索失败不应影响主流程
      console.error('Keyword retrieval failed:', error);
    }
  }

  // 3. 合并去重，按相似度排序后截断
  const merged = new Map<string, ChunkRow>();
  for (const r of vectorResults) merged.set(r.id, r);
  for (const r of keywordResults) {
    if (!merged.has(r.id)) merged.set(r.id, r);
  }

  return [...merged.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_CONTEXT_CHUNKS)
    .map((r) => ({
      content: r.content,
      documentTitle: r.title,
      chunkIndex: r.chunk_index,
      similarity: r.similarity,
      documentId: r.document_id,
    }));
}

/**
 * 查询改写：结合对话历史，把用户的追问改写成一个独立、完整的检索查询。
 *
 * 例如：
 *  用户：A102在2025年的收租情况，请按月列出
 *  助手：（回答）
 *  用户：那2026年呢？
 *  → 改写为「A102在2026年的收租情况，请按月列出」
 *
 * 这样改写后的查询既能命中统计分支（保留编号、年份、统计意图），
 * 也能让 RAG 检索到正确的片段。
 */
export async function rewriteQueryWithHistory(
  history: { role: string; content: string }[],
  latestQuestion: string
): Promise<string> {
  const recent = history.slice(-4);
  const transcript = recent
    .map((m) =>
      m.role === 'user' ? `用户：${m.content}` : `助手：${m.content.slice(0, 500)}`
    )
    .join('\n');

  const prompt = `你是知识库问答系统的查询改写助手。根据下面的对话历史，把用户的最新提问改写成一个独立、完整的检索查询。

要求：
1. 补全省略的信息（例如"那2026年呢？"要补上主题与统计意图，写成"A102在2026年的收租情况，请按月列出"）
2. 保留所有关键信息：编号（如A101、A102）、年份、统计意图（如"按月列出""合计""平均""多少家"）
3. 如果用户提问本身已经完整，直接原样输出
4. 只输出改写后的查询文本本身，不要任何解释、引号或前后缀

对话历史：
${transcript}

请改写用户的最新提问：${latestQuestion}`;

  // 超时保护：把整个改写流程（streamText + 读取响应体）放进 Promise.race，
  // 15 秒拿不到完整结果就走规则兜底，避免网络异常（如响应体被挂起）无限阻塞追问
  try {
    const text = await Promise.race([
      (async () => {
        const result = await streamText({
          model: openai(CHAT_MODEL),
          prompt,
          temperature: 0,
          maxTokens: 200,
        });
        return await result.text;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('改写请求超时（15s）')), 15000)
      ),
    ]);
    const rewritten = text.trim().replace(/^["'“”]|["'“”]$/g, '').trim();
    // LLM 成功改写且结果与原文不同 → 采用
    if (rewritten && rewritten.length >= 2 && rewritten !== latestQuestion) {
      return rewritten;
    }
    // LLM 认为无需改写或结果过短 → 用规则改写兜底（不依赖网络）
    return ruleBasedRewrite(recent, latestQuestion);
  } catch (error) {
    // LLM 调用失败（网络/证书/超时）→ 用规则改写兜底，保证追问仍能接住
    console.error('Query rewrite via LLM failed, using rule-based fallback:', error);
    return ruleBasedRewrite(recent, latestQuestion);
  }
}

/** 把最近的对话历史格式化为背景文本（用于最终回答的上下文增强） */
function formatHistoryBackground(history?: { role: string; content: string }[]): string {
  if (!history || history.length === 0) return '';
  const recent = history.slice(-4);
  const lines = recent.map((m) =>
    m.role === 'user' ? `用户：${m.content}` : `助手：${m.content.slice(0, 800)}`
  );
  return `以下是本次对话的最近历史（用于理解指代，回答时不要复述这些内容）：\n${lines.join('\n')}`;
}

/**
 * 组装 RAG Prompt
 */
export function buildRagPrompt(
  query: string,
  results: SearchResult[],
  history?: { role: string; content: string }[]
): string {
  const historyBg = formatHistoryBackground(history);
  if (results.length === 0) {
    return `用户问题: ${query}\n\n注意: 没有找到相关的参考资料，请告知用户知识库中暂无相关信息。${historyBg ? `\n\n${historyBg}` : ''}`;
  }

  const contextText = results
    .map((r, i) => {
      return `[参考资料 ${i + 1}]\n来源: ${r.documentTitle}\n内容: ${r.content}\n相似度: ${(r.similarity * 100).toFixed(1)}%`;
    })
    .join('\n\n---\n\n');

  return `参考资料:

${contextText}

---

用户问题: ${query}
${historyBg ? `\n${historyBg}` : ''}`;
}

/**
 * 执行 RAG 问答并流式返回结果
 */
export async function ragStream(
  query: string,
  results: SearchResult[],
  history?: { role: string; content: string }[]
) {
  const prompt = buildRagPrompt(query, results, history);

  const result = await streamText({
    model: openai(CHAT_MODEL),
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0.3,
    // 表格类问题需要逐条列出，2000 会在列举时被截断
    maxTokens: 4000,
  });

  return result;
}

/** 操作类型的中文名 */
const OP_LABEL: Record<StatsResult['operation'], string> = {
  sum: '合计',
  avg: '平均',
  count: '数量',
  max: '最大值',
  min: '最小值',
};

/**
 * 组装统计问答的 Prompt
 */
export function buildStatsPrompt(
  query: string,
  docTitle: string | string[],
  stats: StatsResult,
  history?: { role: string; content: string }[]
): string {
  const titles = Array.isArray(docTitle) ? docTitle : [docTitle];
  const opLabel = OP_LABEL[stats.operation];
  const lines: string[] = [];
  const historyBg = formatHistoryBackground(history);

  lines.push(`已对文档「${titles.join('」「')}」的完整表格做了精确统计（不是抽样）：`);
  lines.push(`- 统计指标：${stats.targetColumn}`);
  lines.push(`- 统计方式：${opLabel}`);
  if (stats.filters.length > 0) {
    lines.push(`- 筛选条件：${stats.filters.join('，')}`);
  }
  lines.push(`- 参与统计的记录数：${stats.matchedCount}`);

  if (stats.operation === 'count') {
    lines.push(`- 结果：共 ${stats.total} 条`);
  } else {
    lines.push(`- 结果：${stats.total}`);
  }

  if (stats.groups.length > 0) {
    lines.push(`- 分组明细（共 ${stats.groups.length} 组）：`);
    for (const g of stats.groups) {
      lines.push(`  · ${g.key}：${g.value}`);
    }
  }

  lines.push('');
  lines.push('说明：列名中若含「（1月）」等字样是表格表头的固定写法，不代表只统计单月；真正的时间范围由上面的筛选条件与分组明细决定。');
  lines.push('请基于以上精确统计结果，用自然语言回答用户问题，数字必须与上面完全一致，不要重新计算、不要遗漏任何分组项。');
  lines.push('如涉及分组，用 Markdown 表格列出全部分组明细。');
  if (historyBg) lines.push(`\n${historyBg}`);
  lines.push('');
  lines.push(`用户问题：${query}`);

  return lines.join('\n');
}

/**
 * 统计问答：基于结构化表格数据做精确聚合后流式回答
 */
export async function statsStream(
  query: string,
  docTitle: string | string[],
  stats: StatsResult,
  history?: { role: string; content: string }[]
) {
  const prompt = buildStatsPrompt(query, docTitle, stats, history);

  const result = await streamText({
    model: openai(CHAT_MODEL),
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0.2,
    maxTokens: 3000,
  });

  return result;
}

/**
 * 组装"最新记录"问答的 Prompt。
 * 精确取该对象最新一条记录（程序化排序，不依赖向量检索），让 LLM 组织语言。
 */
export function buildLatestPrompt(
  query: string,
  docTitle: string | string[],
  latest: LatestRecordResult,
  history?: { role: string; content: string }[]
): string {
  const titles = Array.isArray(docTitle) ? docTitle : [docTitle];
  const historyBg = formatHistoryBackground(history);

  const fieldLines = Object.entries(latest.latest.cells)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  return `已从文档「${titles.join('」「')}」中精确找到「${latest.targetName}」的最新一条记录（该对象共有 ${latest.matchedCount} 条历史记录，时间范围 ${latest.range.earliest} 至 ${latest.range.latest}）。

最新记录（${latest.latest.section}）：
${fieldLines}

要求：
1. 基于上面这条"最新记录"回答用户问题（如租金、电费、水费等字段），数字必须与记录完全一致，不要编造。
2. 回答时明确说明该记录所属月份（${latest.latest.section}），并可用一句说明该对象的时间范围（${latest.range.earliest} 至 ${latest.range.latest}）。
3. 若问题询问的字段在最新记录中为空，请如实说明该字段最新记录未填写，不要用历史月份的数据冒充。${historyBg ? `\n${historyBg}` : ''}

用户问题：${query}`;
}

/**
 * 最新记录问答：基于精确取出的最新一条记录流式回答
 */
export async function latestStream(
  query: string,
  docTitle: string | string[],
  latest: LatestRecordResult,
  history?: { role: string; content: string }[]
) {
  const prompt = buildLatestPrompt(query, docTitle, latest, history);

  const result = await streamText({
    model: openai(CHAT_MODEL),
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0.1,
    maxTokens: 1200,
  });

  return result;
}

/**
 * 完整的文档入库流程：解析 -> 分块 -> 生成向量 -> 存入数据库
 */
export async function ingestDocument(
  text: string,
  title: string,
  sourceType: string,
  fileSize: number,
  tableData?: unknown
): Promise<{ documentId: string; chunkCount: number }> {
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    throw new Error('文档分块后没有有效内容。');
  }

  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

  return withTransaction(async (client) => {
    // 插入文档记录
    const docResult = await client.query<{ id: string }>(
      `INSERT INTO documents (title, source_type, content, table_data, chunk_count, file_size)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id`,
      [
        title,
        sourceType,
        text,
        tableData ? JSON.stringify(tableData) : null,
        chunks.length,
        fileSize,
      ]
    );
    const documentId = docResult.rows[0].id;

    // 批量插入分块和向量
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      const vectorStr = toPgVector(embedding);

      await client.query(
        `INSERT INTO document_chunks (document_id, content, chunk_index, embedding, token_count)
         VALUES ($1, $2, $3, $4::vector, $5)`,
        [documentId, chunk.content, chunk.chunkIndex, vectorStr, chunk.tokenCount]
      );
    }

    return { documentId, chunkCount: chunks.length };
  });
}

/**
 * 获取所有文档列表
 */
export async function getAllDocuments(): Promise<DocumentRecord[]> {
  return query<DocumentRecord>(
    `SELECT id, title, source_type, content, chunk_count, created_at
     FROM documents
     ORDER BY created_at DESC`
  );
}

/**
 * 删除文档及其所有分块
 */
export async function deleteDocument(documentId: string): Promise<void> {
  await query(`DELETE FROM documents WHERE id = $1`, [documentId]);
}

/**
 * 获取文档的分块内容（用于查看详情）
 */
export async function getDocumentChunks(documentId: string): Promise<ChunkRecord[]> {
  return query<ChunkRecord>(
    `SELECT id, document_id, content, chunk_index
     FROM document_chunks
     WHERE document_id = $1
     ORDER BY chunk_index ASC`,
    [documentId]
  );
}

/**
 * 获取单个文档的结构化表格数据（table_data）
 */
export async function getDocumentTableData(documentId: string): Promise<unknown | null> {
  const rows = await query<{ table_data: unknown }>(
    `SELECT table_data FROM documents WHERE id = $1`,
    [documentId]
  );
  if (rows.length === 0) return null;
  const raw = rows[0].table_data;
  if (raw === null || raw === undefined) return null;
  // pg 的 jsonb 驱动可能直接返回对象，也可能返回字符串
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * 获取所有带结构化表格数据的文档（用于跨表统计）
 */
export async function getTableDocuments(): Promise<
  { id: string; title: string }[]
> {
  return query<{ id: string; title: string }>(
    `SELECT id, title FROM documents WHERE table_data IS NOT NULL ORDER BY created_at DESC`
  );
}

/**
 * 获取对话历史
 */
export async function getChatHistory(limit: number = 20): Promise<any[]> {
  return query(
    `SELECT id, conversation_id, question, answer, sources, stat_data, created_at
     FROM chat_history
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
}

/**
 * 保存对话记录
 * @param conversationId 所属会话 ID（多会话；为空则不入库会话关联）
 * @param statData 统计问答的图表数据（可选，仅统计分支传入）
 */
export async function saveChatRecord(
  conversationId: string | null,
  question: string,
  answer: string,
  sources: { title: string; similarity: number }[],
  statData?: unknown
): Promise<void> {
  await query(
    `INSERT INTO chat_history (conversation_id, question, answer, sources, stat_data)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      conversationId,
      question,
      answer,
      JSON.stringify(sources),
      statData ? JSON.stringify(statData) : null,
    ]
  );
  // 更新会话的"最后活动时间"（会话列表按此倒序）
  if (conversationId) {
    await query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );
  }
}

/**
 * 删除单条对话记录
 */
export async function deleteChatHistory(id: string): Promise<void> {
  await query(`DELETE FROM chat_history WHERE id = $1`, [id]);
}

/**
 * 清空所有对话记录
 */
export async function clearAllChatHistory(): Promise<void> {
  await query(`DELETE FROM chat_history`);
}

/* ==================== 多会话管理 ==================== */

export interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  last_message_at: string;
  last_question: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  question: string;
  answer: string;
  sources: { title: string; similarity: number }[];
  stat_data: unknown;
  created_at: string;
}

/**
 * 会话列表（按最后活动时间倒序），含消息数与最后一条问题预览
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  return query<ConversationSummary>(
    `SELECT
       c.id,
       c.title,
       COUNT(h.id)::int AS message_count,
       MAX(h.created_at) AS last_message_at,
       (SELECT h2.question FROM chat_history h2 WHERE h2.conversation_id = c.id ORDER BY h2.created_at DESC LIMIT 1) AS last_question,
       c.created_at,
       c.updated_at
     FROM conversations c
     LEFT JOIN chat_history h ON h.conversation_id = c.id
     GROUP BY c.id
     ORDER BY COALESCE(MAX(h.created_at), c.created_at) DESC`
  );
}

/**
 * 新建会话
 */
export async function createConversation(title?: string): Promise<ConversationSummary> {
  const rows = await query<ConversationSummary>(
    `INSERT INTO conversations (title) VALUES ($1)
     RETURNING id, title, 0::int AS message_count, created_at, updated_at,
               NULL::timestamptz AS last_message_at, NULL::text AS last_question`,
    [title?.trim() || '新对话']
  );
  return rows[0];
}

/**
 * 会话详情：基本信息 + 全部消息（按时间正序，便于直接渲染对话流）
 */
export async function getConversationWithMessages(
  conversationId: string
): Promise<{ conversation: ConversationSummary | null; messages: ConversationMessage[] } | null> {
  const convRows = await query<ConversationSummary>(
    `SELECT
       c.id,
       c.title,
       COUNT(h.id)::int AS message_count,
       MAX(h.created_at) AS last_message_at,
       (SELECT h2.question FROM chat_history h2 WHERE h2.conversation_id = c.id ORDER BY h2.created_at DESC LIMIT 1) AS last_question,
       c.created_at,
       c.updated_at
     FROM conversations c
     LEFT JOIN chat_history h ON h.conversation_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
    [conversationId]
  );
  if (convRows.length === 0) return null;

  const msgRows = await query<ConversationMessage>(
    `SELECT id, question, answer, sources, stat_data, created_at
     FROM chat_history
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );

  return { conversation: convRows[0], messages: msgRows };
}

/**
 * 删除会话（级联删除其下所有消息）
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  await query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
}

/**
 * 重命名会话
 */
export async function renameConversation(
  conversationId: string,
  title: string
): Promise<void> {
  await query(`UPDATE conversations SET title = $2 WHERE id = $1`, [
    conversationId,
    title.trim() || '新对话',
  ]);
}

/**
 * 会话第一条消息产生后，用问题自动命名（仅当标题仍为默认"新对话"时）
 * @returns 是否执行了命名
 */
export async function autoTitleConversation(
  conversationId: string,
  question: string
): Promise<boolean> {
  const rows = await query<{ is_default: boolean }>(
    `SELECT (title = '新对话' OR title = '') AS is_default FROM conversations WHERE id = $1`,
    [conversationId]
  );
  if (rows.length === 0 || !rows[0].is_default) return false;
  const title = question.replace(/\s+/g, ' ').trim().slice(0, 30);
  await renameConversation(conversationId, title || '新对话');
  return true;
}
