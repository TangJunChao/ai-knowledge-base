/**
 * 多轮追问的本地规则改写（纯函数，不依赖任何外部服务）。
 *
 * 当 LLM 改写不可用（网络/证书异常、超时）时，用纯规则从对话历史中
 * 提取关键信息（编号、统计意图），结合追问内容构造一个尽可能完整的查询，
 * 保证统计分支（isStatisticalQuery）和 RAG 检索仍能工作。
 *
 * 例如：
 *  上一问：A102在2025年的收租情况，请按月列出
 *  追问：  那2026年呢？
 *  → 改写：A102 那2026年呢？ 按月
 */

export interface HistoryMsg {
  role: string;
  content: string;
}

/** 统计意图关键词（用于继承上一问的统计诉求） */
const STAT_INTENT_KEYWORDS = [
  '按月', '每月', '各月', '逐月', '月度', '分月',
  '合计', '总共', '总计', '一共', '汇总', '累计',
  '平均', '均值',
  '多少家', '几家', '几个', '几户',
  '最高', '最低', '最多', '最少', '最大', '最小',
];

/** 提取编号类 token（A102、A604 等） */
function extractCodeTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z]{1,3}\d{2,}[A-Za-z0-9]*/g)) {
    tokens.add(m[0].toUpperCase());
  }
  return [...tokens];
}

/** 提取文本中的年份（20xx），去重 */
function extractYears(text: string): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(/20\d{2}/g)) {
    seen.add(parseInt(m[0], 10));
  }
  return [...seen];
}

/**
 * 基于最近一轮历史，把追问改写为独立完整的查询。
 * 无法提取到有用信息时原样返回。
 */
export function ruleBasedRewrite(
  history: HistoryMsg[],
  latestQuestion: string
): string {
  // 找最近一条用户消息
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUser) return latestQuestion;
  const prev = lastUser.content;

  const prevCodes = extractCodeTokens(prev);
  const curCodes = extractCodeTokens(latestQuestion);

  // 追问自身是否已经带主题（编号或主题词）
  const curHasTopic =
    curCodes.length > 0 ||
    /租金|收租|电费|水费|管理费|欠款|欠费|押金|店铺|公司|收了多少/.test(latestQuestion);

  let rebuilt = latestQuestion;

  // 追问缺主题时，补上前一问题的编号
  if (!curHasTopic && prevCodes.length > 0) {
    rebuilt = `${prevCodes.join(' ')} ${rebuilt}`;
  }

  // 追问缺统计意图时，继承上一问的统计意图
  const prevIntents = STAT_INTENT_KEYWORDS.filter((kw) => prev.includes(kw));
  const curHasIntent = STAT_INTENT_KEYWORDS.some((kw) => latestQuestion.includes(kw));
  if (!curHasIntent && prevIntents.length > 0) {
    rebuilt = `${rebuilt} ${prevIntents.slice(0, 2).join(' ')}`;
  }

  // 追问出现新年份时，确保补上该年份（例：那2026年呢 → 2026年）
  const prevYears = extractYears(prev);
  const curYears = extractYears(latestQuestion);
  if (curYears.length > 0 && prevYears.length > 0) {
    // 无操作：年份本身已在追问文本里
  }

  // 统一年份格式，避免"2026"裸数字
  rebuilt = rebuilt.replace(/(20\d{2})(?!年)/g, '$1年');

  return rebuilt.trim();
}
