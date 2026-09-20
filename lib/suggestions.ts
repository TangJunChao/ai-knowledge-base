/**
 * 追问建议生成：回答完成后，基于"用户提问 + AI 回答"生成 2-3 个相关追问。
 *
 * 独立模块（不依赖 RAG 检索）：
 *  - 只用于推荐追问，失败/超时时返回空数组，前端静默忽略，绝不影响主回答。
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';

const SUGGESTION_TIMEOUT_MS = 15000;
const MAX_ANSWER_LEN = 3000;

/** 从 LLM 输出中解析出追问建议列表（多格式容错，取前 3 条） */
function parseSuggestions(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  const normalize = (arr: unknown[]): string[] =>
    arr
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim())
      .filter((s) => s.length >= 4 && s.length <= 60);

  // 1. 整体是 JSON 数组
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) {
      const list = normalize(arr);
      if (list.length > 0) return list.slice(0, 3);
    }
  } catch {
    // 继续尝试其他格式
  }

  // 2. 文本中内嵌 JSON 数组片段（如被解释性文字包裹）
  const bracketMatch = cleaned.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    try {
      const arr = JSON.parse(bracketMatch[0]);
      if (Array.isArray(arr)) {
        const list = normalize(arr);
        if (list.length > 0) return list.slice(0, 3);
      }
    } catch {
      // 继续尝试行拆分
    }
  }

  // 3. 按行拆分（Markdown 列表 / 编号列表）
  const lines = cleaned
    .split('\n')
    .map((l) => l.replace(/^[-*\d.\s、]+/, '').trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim())
    .filter((l) => l.length >= 4 && l.length <= 60);
  return lines.slice(0, 3);
}

/**
 * 生成追问建议。
 * 任何失败（网络/证书/超时/解析失败）都返回空数组，调用方（前端）静默处理。
 */
export async function generateSuggestions(
  question: string,
  answer: string
): Promise<string[]> {
  const prompt = `你是知识库问答系统的追问建议助手。根据"用户提问"和"AI 回答"，生成 2-3 个相关且值得继续深入的问题。

要求：
1. 追问要具体、有信息量，避免"请详细说明""还有吗"这类空泛问法
2. 围绕回答的延伸方向：数据对比、原因分析、时间趋势、特定对象的展开、后续建议等
3. 如果回答涉及表格或统计数据，优先推荐数据比较、趋势、明细类追问
4. 每条追问不超过 30 个字
5. 只输出 JSON 字符串数组，例如 ["追问一","追问二","追问三"]，不要任何解释、序号或前后缀

用户提问：
${question.slice(0, 500)}

AI 回答：
${answer.slice(0, MAX_ANSWER_LEN)}`;

  try {
    const text = await Promise.race([
      (async () => {
        const { text } = await generateText({
          model: openai(CHAT_MODEL),
          prompt,
          temperature: 0.8,
          maxTokens: 200,
        });
        return text;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('追问建议生成超时')), SUGGESTION_TIMEOUT_MS)
      ),
    ]);
    return parseSuggestions(text);
  } catch (error) {
    console.warn('Generate suggestions failed:', error);
    return [];
  }
}
