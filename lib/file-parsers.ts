/**
 * 文件解析工具
 * 支持解析 PDF、Word、Markdown、TXT 等格式
 */

/** 单个工作表的结构化数据 */
export interface TableSheetData {
  /** 工作表名称 */
  name: string;
  /** 表头列名（与行 cells 对齐） */
  headers: string[];
  /** 数据行 */
  rows: {
    /** 所属分组标记（如月份 "2025年1月"；无则空串） */
    section: string;
    /** 与 headers 对齐的单元格文本 */
    cells: string[];
  }[];
}

/** 整个表格的结构化数据（多工作表） */
export type TableData = TableSheetData[];

export interface ParsedFile {
  text: string;
  title: string;
  sourceType: string;
  fileSize: number;
  /** 表格类文件的结构化数据（仅 xlsx/csv），用于统计问答 */
  tableData?: TableData;
}

/**
 * 从文件名中提取不带后缀的文件名作为标题
 */
function extractTitle(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex > 0) {
    return filename.slice(0, dotIndex);
  }
  return filename;
}

/**
 * 根据 MIME 类型或文件扩展名获取 source type
 */
function getSourceType(filename: string, mimeType?: string): string {
  if (mimeType) {
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'markdown';
    if (mimeType === 'text/plain') return 'txt';
    if (mimeType === 'text/html') return 'html';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
    if (mimeType === 'application/vnd.ms-excel') return 'xlsx';
  }
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'docx':
    case 'doc': return 'docx';
    case 'md':
    case 'markdown': return 'markdown';
    case 'txt': return 'txt';
    case 'html':
    case 'htm': return 'html';
    case 'xlsx':
    case 'xls':
    case 'csv': return 'xlsx';
    default: return 'text';
  }
}

/**
 * 解析文件 Buffer 为纯文本
 */
export async function parseFile(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<ParsedFile> {
  const sourceType = getSourceType(filename, mimeType);
  const title = extractTitle(filename);
  const fileSize = buffer.length;

  let text: string;
  let tableData: TableData | undefined;

  switch (sourceType) {
    case 'pdf':
      text = await parsePDF(buffer);
      break;
    case 'docx':
      text = await parseDocx(buffer);
      break;
    case 'xlsx': {
      const parsed = await parseXlsx(buffer);
      text = parsed.text;
      tableData = parsed.table;
      break;
    }
    case 'markdown':
    case 'txt':
    case 'html':
    case 'text':
      text = buffer.toString('utf-8');
      break;
    default:
      text = buffer.toString('utf-8');
  }

  text = text.replace(/\u0000/g, '').trim();

  if (!text) {
    throw new Error('无法从文件中提取文本内容，请确认文件格式正确。');
  }

  return { text, title, sourceType, fileSize, tableData };
}

async function parsePDF(buffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/** Excel 日期序列号的基准时间（1899-12-30，UTC） */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/**
 * 把 SheetJS 返回的 Date 还原为 Excel 日期序列号。
 *
 * SheetJS 在 cellDates 模式下会用「本地时区」构造 Date，导致结果带上
 * 由 1899 年 LMT 偏移产生的零头（例如 2025-01-01 变成 2024-12-31T15:59:17Z）。
 * 这里反算回序列号并四舍五入，即可消除该误差。
 */
function dateToExcelSerial(date: Date): number {
  return Math.round((date.getTime() - EXCEL_EPOCH_MS) / MS_PER_DAY);
}

/**
 * 序列号 → "2025年1月" / "2025年1月6日"
 * 当月 1 号只输出年月（表格中通常用作月份标记）
 */
function serialToDateText(serial: number): string {
  const d = new Date(EXCEL_EPOCH_MS + serial * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (day === 1) return `${y}年${m}月`;
  return `${y}年${m}月${day}日`;
}

/**
 * 读取单个单元格的文本表示
 * - 日期单元格：转成 "2025年1月" 形式（修正时区误差）
 * - 其他单元格：优先用 cell.w（保留 22573.20 这样的显示精度）
 */
function readCellText(sheet: Record<string, unknown>, addr: string): string {
  const cell = sheet[addr] as
    | { t?: string; v?: unknown; w?: string }
    | undefined;
  if (!cell || cell.v === undefined || cell.v === null || cell.v === '') {
    return '';
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    return serialToDateText(dateToExcelSerial(cell.v));
  }
  if (cell.w) return cell.w.trim();
  return String(cell.v);
}

/**
 * 把工作表转成二维字符串表格
 * 直接按单元格地址读取，避免 sheet_to_json 对日期的美式格式化（如 "1/1/25"）
 */
function sheetToTextGrid(
  XLSX: typeof import('xlsx'),
  sheet: Record<string, unknown>
): string[][] {
  const refStr = sheet['!ref'] as string | undefined;
  if (!refStr) return [];

  const ref = XLSX.utils.decode_range(refStr);
  const grid: string[][] = [];

  for (let r = ref.s.r; r <= ref.e.r; r++) {
    const row: string[] = [];
    for (let c = ref.s.c; c <= ref.e.c; c++) {
      row.push(readCellText(sheet, XLSX.utils.encode_cell({ r, c })));
    }
    grid.push(row);
  }

  return grid;
}

/**
 * 智能表头检测：在前 5 行中找到文本列最多的行作为表头
 * 规则：该行有 >=2 个非纯数字文本值
 */
function detectHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] ?? [];
    let textCount = 0;
    let nonEmptyCount = 0;
    for (const cell of row) {
      if (cell !== '') {
        nonEmptyCount++;
        if (!/^\d+(\.\d+)?$/.test(cell)) textCount++;
      }
    }
    if (nonEmptyCount >= 2 && textCount >= 2) {
      return i;
    }
  }
  return 0;
}

async function parseXlsx(buffer: Buffer): Promise<{ text: string; table: TableData }> {
  const XLSX = await import('xlsx');
  // cellDates: true 让日期单元格标记为 t='d'，便于与普通数字区分
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const sheets: string[] = [];
  const table: TableData = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName] as Record<string, unknown>;
    if (!sheet['!ref']) continue;

    const ref = XLSX.utils.decode_range(sheet['!ref'] as string);
    const merges =
      (sheet['!merges'] as {
        s: { r: number; c: number };
        e: { r: number; c: number };
      }[]) || [];

    const rows = sheetToTextGrid(XLSX, sheet);
    if (rows.length === 0) continue;

    // 构建合并单元格映射：行号 → { 文本, 列索引 }
    // 只关注跨多列的合并（月份标记、合计行标题等）
    const sectionMarkers = new Map<number, { text: string; col: number }>();
    for (const m of merges) {
      if (m.e.c > m.s.c) {
        const rowIdx = m.s.r - ref.s.r;
        if (rowIdx >= 0 && rowIdx < rows.length) {
          const text = (
            rows[rowIdx]?.[m.s.c - ref.s.c] ?? ''
          ).trim();
          if (text) sectionMarkers.set(rowIdx, { text, col: m.s.c - ref.s.c });
        }
      }
    }

    // 检测表头行
    let headerRowIndex = detectHeaderRow(rows);
    if (sectionMarkers.has(headerRowIndex)) {
      headerRowIndex = Math.min(headerRowIndex + 1, rows.length - 1);
    }

    const header = rows[headerRowIndex] ?? [];
    // 列数按工作表最大范围计算：表头行短于数据行时，超出部分补"列N"，
    // 避免数据行末尾的字段（如备注、延伸列）因没有表头名而被静默丢弃
    const colCount = rows[0]?.length ?? header.length;
    const baseHeaderKeys: string[] = [];
    for (let ci = 0; ci < colCount; ci++) {
      const h = (header[ci] ?? '').trim();
      baseHeaderKeys.push(h === '' ? `列${ci + 1}` : h);
    }
    // 去重列名：遇到重复列名追加 #2/#3…，避免下游按列名建键时相互覆盖丢失字段
    // （如左右并排双表时 "日期|楼层|名称|租金…|日期|楼层|名称…"）
    const seenHeader = new Map<string, number>();
    const headerKeys = baseHeaderKeys.map((base) => {
      const count = (seenHeader.get(base) || 0) + 1;
      seenHeader.set(base, count);
      return count === 1 ? base : `${base}#${count}`;
    });

    sheets.push(`## 工作表: ${sheetName}\n`);

    let currentSection = '';
    const sheetRows: TableSheetData['rows'] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];

      const marker = sectionMarkers.get(i);
      if (marker) {
        currentSection = marker.text;
        sheets.push(`\n### ${marker.text}\n`);
        // 标记行（如月份标题）若除标记单元格外还有其他列数据，保留该行数据；
        // 否则该行只是分区标题，跳过
        const hasOtherData = row.some(
          (c, ci) => ci !== marker.col && c.trim() !== ''
        );
        if (!hasOtherData) continue;
      }

      if (i === headerRowIndex) continue;

      if (!row.some((c) => c !== '')) continue;

      // 过滤"重复表头行"：整行的值等于列名本身（如 "序号: 序号 | 楼层: 楼层"）。
      // 这类行是表格里每个月重复出现的表头，不是真实记录，不应进入数据。
      let nonEmpty = 0;
      let eqHeader = 0;
      for (let j = 0; j < baseHeaderKeys.length; j++) {
        const v = (row[j] ?? '').trim();
        if (v !== '') {
          nonEmpty++;
          if (v === baseHeaderKeys[j]) eqHeader++;
        }
      }
      if (nonEmpty > 0 && eqHeader / nonEmpty >= 0.5) continue;

      // 结构化行：cells 与 headers 对齐
      sheetRows.push({
        section: currentSection,
        cells: headerKeys.map((_, j) => (row[j] ?? '').trim()),
      });

      const parts: string[] = [];
      for (let j = 0; j < headerKeys.length; j++) {
        const val = (row[j] ?? '').trim();
        if (val !== '') {
          parts.push(`${headerKeys[j]}: ${val}`);
        }
      }

      if (parts.length > 0) {
        const prefix = currentSection ? `[${currentSection}] ` : '';
        sheets.push(`${prefix}${parts.join(' | ')}`);
      }
    }

    table.push({ name: sheetName, headers: headerKeys, rows: sheetRows });
    sheets.push('');
  }

  return { text: sheets.join('\n').trim(), table };
}
