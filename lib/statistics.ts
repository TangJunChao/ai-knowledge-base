/**
 * 表格统计问答引擎
 *
 * 思路：表格类文档在入库时额外保存了结构化矩阵（table_data）。
 * 对统计类问题（合计/总共/平均/多少家/按月分组…），不再依赖向量检索的
 * Top-K 片段，而是把整张表用程序遍历一遍做精确聚合，数值由代码算出，
 * 最后把精确结果交给 LLM 组织语言，从而彻底避免"漏数据"。
 */

import type { TableData, TableSheetData } from './file-parsers';

/** 一条扁平的表格记录 */
interface FlatRow {
  sheet: string;
  section: string;
  cells: Record<string, string>;
  /** 名称类字段的合并文本（用于过滤匹配） */
  nameText: string;
}

/**
 * 统计意图检测：问题里是否包含统计/聚合语义关键词
 */
const STAT_KEYWORDS = [
  '合计', '总共', '一共', '总计', '总额', '共计', '累计', '汇总',
  '有多少', '多少家', '几个', '几家', '几户', '几家店',
  '平均', '均值', '每月', '按月', '各月', '月度', '逐月',
  '最高', '最低', '最多', '最少', '最大', '最小',
  '欠款', '欠费', '应收', '应付', '收了多少', '付了多少', '收多少钱',
];

export function isStatisticalQuery(question: string): boolean {
  return STAT_KEYWORDS.some((kw) => question.includes(kw));
}

/** "最新/最近/现在" 等取最新记录语义的关键词 */
const LATEST_KEYWORDS = ['最新', '最近', '现在', '当前', '目前', '现时', '现行', '当下', '本月', '上个月'];

/** 判断是否为"取某对象最新一条记录"类问题（如"美味居最新租金多少"） */
export function isLatestQuery(question: string): boolean {
  return LATEST_KEYWORDS.some((kw) => question.includes(kw));
}

/** 最新记录查询的结果 */
export interface LatestRecordResult {
  /** 匹配到的实体（公司名/编号） */
  targetName: string;
  /** 该实体命中的历史记录条数 */
  matchedCount: number;
  /** 时间范围（最早 ~ 最新月份） */
  range: { earliest: string; latest: string };
  /** 最新一条记录（按 section 月份时间排序取最后） */
  latest: { section: string; cells: Record<string, string> };
}

/** 把 "2026年8月" 解析为可比较的数值（年*12+月），无法解析返回 -1 */
function parseSectionTime(section: string): number {
  const m = /(\d{4})年(\d{1,2})月/.exec(section);
  if (m) return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
  return -1;
}

/**
 * 程序化"最新记录"查询：
 * 从表格中找到指定对象（公司名/编号）的全部记录，按月份时间排序，
 * 返回最新一条的完整字段，不依赖向量检索，保证"最新"取的是真正的时间上最后一条。
 * 需要问题中带名称/编号过滤（否则不知道"谁"的最新）。
 */
export function computeLatestRecord(
  table: TableData,
  question: string
): LatestRecordResult | null {
  const rows = flattenRows(table);
  if (rows.length === 0) return null;

  const nameFilters = extractNameFilters(question, rows);
  const codeTokens = extractCodeTokens(question);
  if (nameFilters.length === 0 && codeTokens.length === 0) return null;

  const matched: FlatRow[] = [];
  for (const r of rows) {
    const hay = (r.nameText + ' ' + r.section + ' ' + Object.values(r.cells).join(' ')).toUpperCase();
    const hitName = nameFilters.length === 0 || nameFilters.some((n) => hay.includes(n));
    const hitCode = codeTokens.length === 0 || codeTokens.some((n) => hay.includes(n));
    if (hitName && hitCode) matched.push(r);
  }
  if (matched.length === 0) return null;

  // 按月份时间排序，取最新一条（section 无法解析时间的记录参与计数但不计入排序）
  const timed = matched
    .map((r) => ({ r, t: parseSectionTime(r.section) }))
    .filter((x) => x.t >= 0)
    .sort((a, b) => a.t - b.t);

  if (timed.length === 0) return null;

  const latestRow = timed[timed.length - 1].r;
  const earliestSection = timed[0].r.section;
  const latestSection = latestRow.section;

  // latestRow.cells 是 flattenRows 产出的 {列名: 值} 对象，转成非空字段
  const cells: Record<string, string> = {};
  for (const [k, v] of Object.entries(latestRow.cells)) {
    const t = (v ?? '').trim();
    if (t !== '') cells[k] = t;
  }

  return {
    targetName: nameFilters.join(' ') || codeTokens.join(' '),
    matchedCount: matched.length,
    range: { earliest: earliestSection, latest: latestSection },
    latest: { section: latestSection, cells },
  };
}

/** 提取年份（用于跨表选择与月份过滤） */
export function extractYear(question: string): number | null {
  const m = question.match(/(20\d{2})\s*年?/);
  return m ? parseInt(m[1], 10) : null;
}

/** 提取问题中出现的所有年份（去重、按出现顺序），支持"2025-2026""2025到2026"等写法 */
export function extractYears(question: string): number[] {
  const seen = new Set<number>();
  const years: number[] = [];
  for (const m of question.matchAll(/20\d{2}/g)) {
    const y = parseInt(m[0], 10);
    if (!seen.has(y)) {
      seen.add(y);
      years.push(y);
    }
  }
  return years;
}

/** 列名 → 语义角色识别 */
const NAME_COLUMN_HINTS = ['公司名', '公司名称', '企业名称', '名称', '户名', '租户', '收租单位', '单位'];
const CODE_COLUMN_HINTS = ['楼层', '铺位', '编号', '房号'];
const MONTH_COLUMN_HINTS = ['月份', '所属月', '所属月份'];

/**
 * 把数字文本解析为 number（兼容 "22,573.20" / "￥1,234" / "14,500.00" / 括号负数）
 */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[￥¥,，\s]/g, '');
  if (!s) return null;
  // 括号负数 (123) → -123
  const neg = /^\((.+)\)$/.exec(s);
  if (neg) s = '-' + neg[1];
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 判断某列是否为数字列：非空值中可解析为数字的比例 >= 60% */
function isNumericColumn(sheet: TableSheetData, colIdx: number): boolean {
  let nonEmpty = 0;
  let numeric = 0;
  for (const row of sheet.rows) {
    const v = row.cells[colIdx];
    if (v === undefined || v === '' || v === null) continue;
    nonEmpty++;
    if (parseNumber(v) !== null) numeric++;
  }
  return nonEmpty >= 3 && numeric / nonEmpty >= 0.6;
}

/** 找到含关键词的列索引（数字列优先）；返回 -1 表示未找到 */
function findColumn(sheet: TableSheetData, keyword: string, numericOnly = true): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < sheet.headers.length; i++) {
    const h = sheet.headers[i];
    if (!h.includes(keyword)) continue;
    if (numericOnly && !isNumericColumn(sheet, i)) continue;
    // 精确匹配权重更高
    const score = h === keyword ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** 找到名称列（公司名/楼层）索引，符合多个 hint 则合并文本 */
function collectNameColumns(sheet: TableSheetData): number[] {
  const idxs = new Set<number>();
  for (let i = 0; i < sheet.headers.length; i++) {
    const h = sheet.headers[i];
    if (NAME_COLUMN_HINTS.some((k) => h.includes(k))) idxs.add(i);
    if (CODE_COLUMN_HINTS.some((k) => h.includes(k))) idxs.add(i);
  }
  return [...idxs].sort((a, b) => a - b);
}

/** 找到时间列索引（子表常带"所属月份"列） */
function findMonthColumn(sheet: TableSheetData): number {
  for (let i = 0; i < sheet.headers.length; i++) {
    if (MONTH_COLUMN_HINTS.some((k) => sheet.headers[i].includes(k))) return i;
  }
  return -1;
}

/** 找到主名称列（公司名优先，其次任何 NAME hint） */
function findPrimaryNameColumn(sheet: TableSheetData): number {
  let best = -1;
  for (let i = 0; i < sheet.headers.length; i++) {
    const h = sheet.headers[i];
    if (h.includes('公司名') || h.includes('公司名称') || h.includes('企业名称')) return i;
    if (best < 0 && NAME_COLUMN_HINTS.some((k) => h.includes(k))) best = i;
  }
  if (best >= 0) return best;
  // 退而求其次：楼层列也能区分店铺
  for (let i = 0; i < sheet.headers.length; i++) {
    if (CODE_COLUMN_HINTS.some((k) => sheet.headers[i].includes(k))) return i;
  }
  return -1;
}

/** 展平所有工作表为行 */
function flattenRows(table: TableData): FlatRow[] {
  const out: FlatRow[] = [];
  for (const sheet of table) {
    const nameIdxs = collectNameColumns(sheet);
    const monthIdx = findMonthColumn(sheet);
    for (const row of sheet.rows) {
      const cells: Record<string, string> = {};
      for (let i = 0; i < sheet.headers.length; i++) {
        cells[sheet.headers[i]] = row.cells[i] ?? '';
      }
      const nameParts = nameIdxs.map((i) => row.cells[i]?.trim() ?? '').filter(Boolean);
      // 月份优先取 section（主表按月合并分块），其次取"月份"列
      const section = row.section || (monthIdx >= 0 ? (row.cells[monthIdx] ?? '').trim() : '');
      out.push({
        sheet: sheet.name,
        section,
        cells,
        nameText: nameParts.join(' '),
      });
    }
  }
  return out;
}

/** 通用词/字段词黑名单：LCS 子串匹配到的若恰好是这些词，不能当作名称过滤（太泛） */
const NAME_FILTER_EXCLUDE = new Set([
  '租金', '电费', '水费', '管理费', '税点', '合计', '其他', '序号', '楼层',
  '公司', '日期', '收款', '开票', '所属', '月份', '多少', '最新', '最近',
  '现在', '当前', '目前', '多少家', '几个', '平均', '总共', '一共', '名称',
  '企业', '广州', '住户', '租户', '铺位', '编号', '房号', '出单', '通知',
  '物业', '押金', '面积', '单位', '备注', '网络', '网费', '合计总额', '姓',
]);

/** 计算 question 与 name 的最长公共连续子串（用于"神拓"↔"神拓科技"这种简称匹配） */
function longestCommonSubstring(question: string, name: string): string {
  let best = '';
  for (let i = 0; i < name.length; i++) {
    for (let j = 0; j < question.length; j++) {
      let k = 0;
      while (
        i + k < name.length &&
        j + k < question.length &&
        name[i + k] === question[j + k]
      ) {
        k++;
      }
      if (k > best.length) best = name.slice(i, i + k);
    }
  }
  return best;
}

/** 从问题中提取名称过滤词（匹配 nameText 或任意文本） */
function extractNameFilters(question: string, rows: FlatRow[]): string[] {
  // 候选词来源：表格里的公司名/楼层，反查哪些在问题中出现
  const candidates = new Set<string>();
  for (const r of rows) {
    if (!r.nameText) continue;
    for (const part of r.nameText.split(/\s+/)) {
      const t = part.trim();
      if (!t) continue;
      candidates.add(t);
      // 拆出括号内的简称（"益民药店（颜艳）" → "益民药店"）
      const noParen = t.replace(/[（(][^）)]*[）)]/g, '').trim();
      if (noParen && noParen.length >= 2) candidates.add(noParen);
      // 拆出括号内的内容（"益民药店（颜艳）" → "颜艳"）
      const inParen = /[（(]([^）)]+)[）)]/.exec(t);
      if (inParen && inParen[1].trim().length >= 2) candidates.add(inParen[1].trim());
    }
  }

  const hits: string[] = [];

  // 1) 正向匹配：问题包含完整候选（"美味居最新" 命中 "美味居"）
  for (const c of candidates) {
    if (c.length >= 2 && question.includes(c) && !NAME_FILTER_EXCLUDE.has(c)) {
      hits.push(c);
    }
  }

  // 2) 子串匹配：问题包含候选名的某个连续片段
  //    （"神拓最新电费" 命中 "神拓科技" → "神拓"；"暨肽最新" 命中 "广州暨肽基因科技有限公司" → "暨肽"）
  if (hits.length === 0) {
    for (const c of candidates) {
      const lcs = longestCommonSubstring(question, c);
      if (lcs.length >= 2 && !NAME_FILTER_EXCLUDE.has(lcs)) {
        hits.push(lcs);
      }
    }
  }

  return [...new Set(hits)];
}

/** 从问题中提取编号类 token（A101、A604、609 等） */
function extractCodeTokens(question: string): string[] {
  const tokens = new Set<string>();
  for (const m of question.matchAll(/[A-Za-z]{1,3}\d{2,}[A-Za-z0-9]*/g)) {
    tokens.add(m[0].toUpperCase());
  }
  return [...tokens];
}

export interface StatsResult {
  /** 统计列名 */
  targetColumn: string;
  /** 操作类型 */
  operation: 'sum' | 'avg' | 'count' | 'max' | 'min';
  /** 命中的记录数 */
  matchedCount: number;
  /** 总体结果（无分组时） */
  total: number | null;
  /** 分组结果 */
  groups: { key: string; value: number }[];
  /** 命中的总行数（未过滤时） */
  matchedRowsBySheet: { sheet: string; rows: number }[];
  /** 已应用的过滤条件描述（名称/编号/年份） */
  filters: string[];
}

/**
 * 程序化聚合统计。
 * 返回结构化结果，供 chat 路由直接喂给 LLM 组织答案。
 */
export function computeStatistics(
  table: TableData,
  question: string
): StatsResult | null {
  const rows = flattenRows(table);
  if (rows.length === 0) return null;

  const nameFilters = extractNameFilters(question, rows);
  const codeTokens = extractCodeTokens(question);
  const years = extractYears(question);

  // 1. 解析统计操作
  let operation: StatsResult['operation'] = 'sum';
  if (/平均|均值/.test(question)) operation = 'avg';
  else if (/多少个|多少家|几个|几家|几户|几间|几笔|数量|几家店|有几家/.test(question)) operation = 'count';
  else if (/最高|最多|最大/.test(question)) operation = 'max';
  else if (/最低|最少|最小/.test(question)) operation = 'min';

  // 2. 确定统计列：优先问题里点名的指标
  const columnKeywords = ['租金', '电费', '水费', '管理费', '税点', '欠款', '欠费', '押金', '合计'];
  let targetColumn = '';
  let targetColIdx = -1;
  let targetSheetName = '';
  for (const kw of columnKeywords) {
    if (!question.includes(kw)) continue;
    for (const sheet of table) {
      const idx = findColumn(sheet, kw, true);
      if (idx >= 0) {
        targetColumn = sheet.headers[idx];
        targetColIdx = idx;
        targetSheetName = sheet.name;
        break;
      }
    }
    if (targetColIdx >= 0) break;
  }
  // 兜底：用"合计"列；再不行用第一个数字列
  if (targetColIdx < 0) {
    for (const sheet of table) {
      let idx = findColumn(sheet, '合计', true);
      if (idx < 0) {
        for (let i = 0; i < sheet.headers.length; i++) {
          if (isNumericColumn(sheet, i)) {
            idx = i;
            break;
          }
        }
      }
      if (idx >= 0) {
        targetColumn = sheet.headers[idx];
        targetColIdx = idx;
        targetSheetName = sheet.name;
        break;
      }
    }
  }
  if (targetColIdx < 0) return null;

  // 计数类问题：按"主名称列"去重计店数/户数，而非数数字行
  let countByIdentity = false;
  if (operation === 'count') {
    for (const sheet of table) {
      const nameIdx = findPrimaryNameColumn(sheet);
      if (nameIdx >= 0) {
        targetColumn = sheet.headers[nameIdx];
        targetColIdx = nameIdx;
        targetSheetName = sheet.name;
        countByIdentity = true;
        break;
      }
    }
  }

  // 3. 分组维度
  const groupByMonth = /每月|按月|各月|月度|逐月|分月/.test(question);
  const groupByName = /每家|各店|各店铺|每个公司|各公司|各户|逐户|每户/.test(question);

  // 4. 过滤 + 取值
  const matched: { row: FlatRow; value: number | null }[] = [];
  const sheetCount: Record<string, number> = {};
  const filters: string[] = [];
  if (years.length === 1) filters.push(`${years[0]}年`);
  else if (years.length > 1) {
    const span = `${Math.min(...years)}年-${Math.max(...years)}年`;
    filters.push(span);
  }
  nameFilters.forEach((n) => filters.push(`名称含「${n}」`));
  codeTokens.forEach((n) => filters.push(`编号「${n}」`));

  for (const r of rows) {
    const isRowInTargetSheet = r.sheet === targetSheetName;

    // 年份过滤：命中任一指定年份（section 或 nameText）
    if (years.length > 0) {
      const hasYear = years.some(
        (y) => r.section.includes(String(y)) || r.nameText.includes(String(y))
      );
      if (!hasYear) continue;
    }

    // 名称/编号过滤
    if (nameFilters.length > 0 || codeTokens.length > 0) {
      const hay = (r.nameText + ' ' + r.section + ' ' + Object.values(r.cells).join(' ')).toUpperCase();
      const hitName = nameFilters.length === 0 || nameFilters.some((n) => hay.includes(n));
      const hitCode = codeTokens.length === 0 || codeTokens.some((n) => hay.includes(n));
      if (!(hitName && hitCode)) continue;
    }

    // 计数操作：按主名称去重（店铺数/公司数）
    if (operation === 'count') {
      const cell = (r.cells[targetColumn] ?? '').trim();
      if (cell !== '' && isRowInTargetSheet) {
        matched.push({ row: r, value: null });
        sheetCount[r.sheet] = (sheetCount[r.sheet] || 0) + 1;
      }
      continue;
    }

    if (!isRowInTargetSheet) continue;

    const val = parseNumber(r.cells[targetColumn]);
    if (val !== null) {
      matched.push({ row: r, value: val });
      sheetCount[r.sheet] = (sheetCount[r.sheet] || 0) + 1;
    }
  }

  if (matched.length === 0) {
    return {
      targetColumn,
      operation,
      matchedCount: 0,
      total: null,
      groups: [],
      matchedRowsBySheet: [],
      filters,
    };
  }

  // 5. 聚合
  const keyOf = (r: FlatRow): string => {
    if (groupByMonth) return r.section || r.sheet;
    if (groupByName) return r.nameText || '未命名';
    // 无分组 → 汇总
    return '__total__';
  };

  if (operation === 'count') {
    if (countByIdentity) {
      // 对主名称去重计数（店铺数/公司数）
      const identityKey = (r: FlatRow): string =>
        (r.cells[targetColumn] ?? '').trim() || r.nameText || (r.section || '') + '|' + r.sheet;

      if (groupByMonth || groupByName) {
        const map = new Map<string, Set<string>>();
        for (const m of matched) {
          const g = keyOf(m.row);
          if (!map.has(g)) map.set(g, new Set());
          map.get(g)!.add(identityKey(m.row));
        }
        const groups = [...map.entries()].map(([key, set]) => ({ key, value: set.size }));
        const total = groups.reduce((s, g) => s + g.value, 0);
        return {
          targetColumn,
          operation,
          matchedCount: matched.length,
          total,
          groups,
          matchedRowsBySheet: Object.entries(sheetCount).map(([sheet, rows]) => ({ sheet, rows })),
          filters,
        };
      }

      const uniq = new Set(matched.map((m) => identityKey(m.row)));
      return {
        targetColumn,
        operation,
        matchedCount: matched.length,
        total: uniq.size,
        groups: [],
        matchedRowsBySheet: Object.entries(sheetCount).map(([sheet, rows]) => ({ sheet, rows })),
        filters,
      };
    }

    const map = new Map<string, number>();
    for (const m of matched) {
      const k = keyOf(m.row);
      map.set(k, (map.get(k) || 0) + 1);
    }
    const groups = [...map.entries()].map(([key, value]) => ({ key, value }));
    const total = groups.reduce((s, g) => s + g.value, 0);
    return {
      targetColumn,
      operation,
      matchedCount: matched.length,
      total,
      groups: groupByMonth || groupByName ? groups : [],
      matchedRowsBySheet: Object.entries(sheetCount).map(([sheet, rows]) => ({ sheet, rows })),
      filters,
    };
  }

  // 数值聚合
  const map = new Map<string, number[]>();
  for (const m of matched) {
    if (m.value === null) continue;
    const k = keyOf(m.row);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(m.value);
  }

  const aggregate = (vals: number[]): number => {
    if (vals.length === 0) return 0;
    if (operation === 'avg') return vals.reduce((s, v) => s + v, 0) / vals.length;
    if (operation === 'max') return Math.max(...vals);
    if (operation === 'min') return Math.min(...vals);
    return vals.reduce((s, v) => s + v, 0);
  };

  const entries = [...map.entries()].map(([key, vals]) => ({ key, value: aggregate(vals) }));
  const total = aggregate(matched.map((m) => m.value!).filter((v): v is number => v !== null));

  return {
    targetColumn,
    operation,
    matchedCount: matched.length,
    total: Math.round(total * 100) / 100,
    groups: (groupByMonth || groupByName ? entries : []).map((e) => ({
      key: e.key,
      value: Math.round(e.value * 100) / 100,
    })),
    matchedRowsBySheet: Object.entries(sheetCount).map(([sheet, rows]) => ({ sheet, rows })),
    filters,
  };
}

/**
 * 合并多个文档的统计结果（跨表/跨年统计时用）。
 * - 相同分组键（如月份/名称）的数值相加
 * - 无分组时 total 按操作语义合并
 */
export function mergeStats(all: StatsResult[]): StatsResult | null {
  const valid = all.filter((s) => s && s.matchedCount > 0);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const first = valid[0];
  const operation = first.operation;
  const targetColumn = first.targetColumn;

  // 合并分组：同键相加
  const groupMap = new Map<string, number>();
  for (const s of valid) {
    for (const g of s.groups) {
      groupMap.set(g.key, (groupMap.get(g.key) || 0) + g.value);
    }
  }
  const groups = [...groupMap.entries()].map(([key, value]) => ({
    key,
    value: Math.round(value * 100) / 100,
  }));

  let total: number | null = null;
  if (groups.length > 0) {
    // 有分组时 total 由分组推导
    if (operation === 'max') total = Math.max(...groups.map((g) => g.value));
    else if (operation === 'min') total = Math.min(...groups.map((g) => g.value));
    else total = groups.reduce((s, g) => s + g.value, 0);
  } else {
    const totals = valid.map((s) => s.total).filter((t): t is number => t !== null);
    if (totals.length > 0) {
      if (operation === 'avg') {
        total = totals.reduce((s, t) => s + t, 0) / totals.length;
      } else if (operation === 'max') {
        total = Math.max(...totals);
      } else if (operation === 'min') {
        total = Math.min(...totals);
      } else {
        total = totals.reduce((s, t) => s + t, 0);
      }
    }
  }
  if (total !== null) total = Math.round(total * 100) / 100;

  const filters = [...new Set(valid.flatMap((s) => s.filters))];
  const matchedRowsBySheet = valid.flatMap((s) => s.matchedRowsBySheet);

  return {
    targetColumn,
    operation,
    matchedCount: valid.reduce((s, x) => s + x.matchedCount, 0),
    total,
    groups,
    matchedRowsBySheet,
    filters,
  };
}