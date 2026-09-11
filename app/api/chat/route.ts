/**
 * 聊天 API - RAG 问答接口
 * 流式返回 AI 回答
 *
 * POST /api/chat
 * Body: { messages: Message[] }
 * Response: SSE stream
 */

import {
  retrieveContext,
  ragStream,
  statsStream,
  latestStream,
  saveChatRecord,
  getDocumentTableData,
  getTableDocuments,
  rewriteQueryWithHistory,
} from '@/lib/rag';
import {
  isStatisticalQuery,
  isLatestQuery,
  computeStatistics,
  computeLatestRecord,
  extractYears,
  mergeStats,
  type StatsResult,
  type LatestRecordResult,
} from '@/lib/statistics';
import type { TableData } from '@/lib/file-parsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages } = body as { messages: { role: string; content: string }[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: '消息不能为空' }, { status: 400 });
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      return Response.json({ error: '最后一条消息必须是用户消息' }, { status: 400 });
    }

    const question = lastMessage.content;

    // ===== 多轮追问：查询改写 =====
    // 当存在对话历史时，把追问（如"那2026年呢？"）结合历史改写成独立完整的查询，
    // 这样统计分支能识别年份/编号/统计意图，RAG 也能检索到正确片段。
    const history = messages.slice(0, -1).filter((m) => m.role === 'user' || m.role === 'assistant');
    let query = question;
    if (history.length >= 2) {
      const rewritten = await rewriteQueryWithHistory(history, question);
      if (rewritten && rewritten !== question) {
        query = rewritten;
      }
    }

    // ===== 分支零：最新记录问答 =====
    // "美味居最新租金多少" 这类"取某对象最新一条记录"的问题，
    // 不依赖向量检索 Top-K（否则可能只召回一条旧记录），而是遍历结构化表格
    // 按月份时间排序精确取最新一条。仅在无聚合语义（合计/平均/多少家）时走此分支。
    if (isLatestQuery(query) && !isStatisticalQuery(query)) {
      const latestAttempt = await tryLatestAnswer(query, history);
      if (latestAttempt) {
        const { result, sources } = latestAttempt;
        const response = result.toDataStreamResponse({
          headers: {
            'X-Search-Results': encodeURIComponent(JSON.stringify(sources)),
            'X-Stat-Mode': 'latest',
          },
        });
        result.text
          .then((text) => {
            saveChatRecord(question, text, sources).catch(console.error);
          })
          .catch(console.error);
        return response;
      }
      // 未命中则继续走统计 / RAG
    }

    // ===== 分支一：表格统计问答 =====
    // 统计类问题走结构化表格精确聚合，避免向量检索 Top-K 漏数据
    if (isStatisticalQuery(query)) {
      const statAttempt = await tryStatisticsAnswer(query, history);
      if (statAttempt) {
        const { result, docTitle, sources, chart } = statAttempt;
        const response = result.toDataStreamResponse({
          headers: {
            'X-Search-Results': encodeURIComponent(JSON.stringify(sources)),
            'X-Stat-Mode': '1',
            // 携带结构化分组数据，前端可直接渲染图表，无需从文本解析数字
            'X-Stat-Data': encodeURIComponent(JSON.stringify(chart)),
          },
        });
        result.text
          .then((text) => {
            saveChatRecord(question, text, sources, chart).catch(console.error);
          })
          .catch(console.error);
        return response;
      }
      // 统计失败则回退到普通 RAG
    }

    // ===== 分支二：普通 RAG 问答 =====
    const results = await retrieveContext(query);
    const result = await ragStream(query, results, history);

    const sources = results.map((r) => ({
      title: r.documentTitle,
      similarity: r.similarity,
    }));

    const sourcesJson = JSON.stringify(
      results.map((r) => ({
        title: r.documentTitle,
        similarity: parseFloat(r.similarity.toFixed(4)),
      }))
    );

    const response = result.toDataStreamResponse({
      headers: {
        'X-Search-Results': encodeURIComponent(sourcesJson),
      },
    });

    result.text
      .then((text) => {
        saveChatRecord(question, text, sources).catch(console.error);
      })
      .catch(console.error);

    return response;
  } catch (error) {
    console.error('Chat API error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: '服务器内部错误', detail: message },
      { status: 500 }
    );
  }
}

/**
 * 尝试对"最新记录"类问题执行程序化查询。
 * 遍历所有结构化文档，取指定对象时间上最新一条；多文档命中时选时间最新的结果。
 * 成功返回流式结果 + 来源；失败返回 null（回退统计 / RAG）。
 */
async function tryLatestAnswer(
  question: string,
  history?: { role: string; content: string }[]
) {
  const tableDocs = await getTableDocuments();
  if (tableDocs.length === 0) return null;

  const years = extractYears(question);

  const hits: { title: string; latest: LatestRecordResult }[] = [];

  for (const doc of tableDocs) {
    // 若问题明确指定年份，跳过标题不含这些年份的文档
    if (years.length > 0) {
      const docYears = (doc.title.match(/20\d{2}/g) || []).map((s) => parseInt(s, 10));
      if (!docYears.some((y) => years.includes(y))) continue;
    }

    const tableData = (await getDocumentTableData(doc.id)) as TableData | null;
    if (!tableData || !Array.isArray(tableData) || tableData.length === 0) continue;

    const latest = computeLatestRecord(tableData, question);
    if (latest) hits.push({ title: doc.title, latest });
  }

  if (hits.length === 0) return null;

  // 多文档命中时（如 2025 表与 2026 表都含该对象），选"最新月份"最大的结果
  const parseTime = (s: string): number => {
    const m = /(\d{4})年(\d{1,2})月/.exec(s);
    return m ? parseInt(m[1], 10) * 12 + parseInt(m[2], 10) : -1;
  };
  hits.sort((a, b) => parseTime(b.latest.latest.section) - parseTime(a.latest.latest.section));

  const best = hits[0];
  const docTitles = [...new Set(hits.map((h) => h.title))];
  const result = await latestStream(question, docTitles, best.latest, history);

  return {
    result,
    docTitle: docTitles.join('、'),
    sources: docTitles.map((title) => ({ title, similarity: 1 })),
  };
}

/**
 * 尝试对统计类问题执行结构化表格统计。
 * 成功返回流式结果 + 来源；失败返回 null（回退普通 RAG）。
 */
async function tryStatisticsAnswer(
  question: string,
  history?: { role: string; content: string }[]
) {
  // 1. 找出所有带结构化表格数据的文档
  const tableDocs = await getTableDocuments();
  if (tableDocs.length === 0) return null;

  // 2. 计算涉及年份与标题中的年份
  const years = extractYears(question);

  // 3. 对每个候选文档分别统计，收集命中结果
  const hits: { title: string; stats: StatsResult }[] = [];

  for (const doc of tableDocs) {
    // 若问题明确指定年份范围，标题不含这些年份的文档直接跳过
    if (years.length > 0) {
      const docYears = (doc.title.match(/20\d{2}/g) || []).map((s) => parseInt(s, 10));
      const overlap = docYears.some((y) => years.includes(y));
      if (!overlap) continue;
    }

    const tableData = (await getDocumentTableData(doc.id)) as TableData | null;
    if (!tableData || !Array.isArray(tableData) || tableData.length === 0) continue;

    const stats = computeStatistics(tableData, question);
    if (stats && stats.matchedCount > 0) {
      hits.push({ title: doc.title, stats });
    }
  }

  if (hits.length === 0) return null;

  // 4. 合并多个文档的统计结果（跨表/跨年）
  const merged = mergeStats(hits.map((h) => h.stats));
  if (!merged) return null;

  const docTitles = [...new Set(hits.map((h) => h.title))];
  const result = await statsStream(question, docTitles, merged, history);

  // 分组按时间/名称自然排序，保证图表从左到右是正确顺序
  const sortedGroups = [...merged.groups].sort((a, b) => {
    const pa = a.key.match(/(\d{4})年(\d{1,2})月/);
    const pb = b.key.match(/(\d{4})年(\d{1,2})月/);
    if (pa && pb) {
      if (pa[1] !== pb[1]) return parseInt(pa[1], 10) - parseInt(pb[1], 10);
      return parseInt(pa[2], 10) - parseInt(pb[2], 10);
    }
    return a.key.localeCompare(b.key, 'zh-CN');
  });

  return {
    result,
    docTitle: docTitles.join('、'),
    sources: docTitles.map((title) => ({ title, similarity: 1 })),
    // 图表数据：前端据此渲染柱状图/折线图
    chart: {
      targetColumn: merged.targetColumn,
      operation: merged.operation,
      total: merged.total,
      groups: sortedGroups,
      filters: merged.filters,
    },
  };
}