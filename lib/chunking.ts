/**
 * 文本分块工具
 * 将长文本按固定大小切分为多个片段，保留重叠部分以保持上下文连续性
 *
 * 重要：分块采用"按行累积、断点必在行边界"的策略。
 * 表格类文本每行是一条完整记录（如「序号: 1 | 楼层: A617 | … | 水费(12月）: 87.00 | …」），
 * 若在行内任意空格处断块，会把「水费(12月）:」和后面的金额「87.00」切到两个块，
 * 检索到的片段就只剩残缺的字段名，导致回答"金额被截断"。
 * 因此先按 \n 切行，累积到阈值后在行的边界断开，保证记录永远完整。
 */

export interface TextChunk {
  content: string;
  chunkIndex: number;
  tokenCount: number;
}

export interface ChunkingOptions {
  chunkSize: number;
  chunkOverlap: number;
}

const DEFAULT_OPTIONS: ChunkingOptions = {
  chunkSize: parseInt(process.env.CHUNK_SIZE || '800', 10),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200', 10),
};

/**
 * 简易 token 估算
 * 中文约 1 字 = 1 token，英文约 1 词 = 1.3 token
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const others = text.length - chineseChars - englishWords;
  return Math.ceil(chineseChars + englishWords * 1.3 + others * 0.5);
}

/**
 * 从 buffer 尾部保留用于 overlap 的文本。
 * 尽量从最近的行边界开始保留，避免把一行从中间切断（overlap 本身是冗余上下文，允许不完整）。
 */
function keepOverlap(buffer: string, overlap: number): string {
  if (buffer.length <= overlap) return buffer;
  const tail = buffer.slice(-overlap);
  const nl = tail.indexOf('\n');
  if (nl !== -1 && nl < tail.length - 1) {
    return tail.slice(nl + 1);
  }
  return tail;
}

/**
 * 对超长单行（长度 >= chunkSize）的退化处理：
 * 此时无法用行边界断块，只能按字符切。断点优先选句号、表格字段分隔符「 | 」、普通空格。
 */
function chunkLongLine(line: string, opts: ChunkingOptions): string[] {
  const { chunkSize, chunkOverlap } = opts;
  const out: string[] = [];
  let startIndex = 0;

  while (startIndex < line.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex >= line.length) {
      out.push(line.slice(startIndex));
      break;
    }

    let breakPoint = endIndex;
    const lookBack = Math.min(100, chunkSize);

    // 优先级：句号 > 表格字段分隔符「 | 」 > 普通空格
    const sentenceEnd = line.lastIndexOf('。', endIndex);
    const pipe = line.lastIndexOf(' | ', endIndex);
    const space = line.lastIndexOf(' ', endIndex);

    const candidates = [sentenceEnd, pipe, space].filter(
      (pos) => pos > startIndex + chunkSize - lookBack
    );

    if (candidates.length > 0) {
      breakPoint = Math.max(...candidates) + 1;
    }

    out.push(line.slice(startIndex, breakPoint));
    startIndex = breakPoint - chunkOverlap;
    if (startIndex < 0) startIndex = 0;
    if (startIndex >= endIndex - chunkOverlap) {
      startIndex = endIndex;
    }
  }

  return out;
}

/**
 * 按字符长度分块，保留重叠部分。
 * 断点优先落在行边界，保证表格记录/金额不被切断。
 */
export function chunkText(
  text: string,
  options: Partial<ChunkingOptions> = {}
): TextChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { chunkSize, chunkOverlap } = opts;

  if (!text || text.trim().length === 0) {
    return [];
  }

  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const lines = cleaned.split('\n');

  const chunks: TextChunk[] = [];
  let buffer = '';
  let chunkIndex = 0;

  const pushChunk = (content: string) => {
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      chunks.push({
        content: trimmed,
        chunkIndex,
        tokenCount: estimateTokens(trimmed),
      });
      chunkIndex++;
    }
  };

  for (const line of lines) {
    // 超长单行：无法按行边界断块，退化用字符级断点
    if (line.length >= chunkSize) {
      pushChunk(buffer);
      for (const sub of chunkLongLine(line, opts)) {
        pushChunk(sub);
      }
      buffer = '';
      continue;
    }

    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (buffer && candidate.length > chunkSize) {
      pushChunk(buffer);
      // overlap：保留上一块尾部的完整行，作为下一块的上下文
      buffer = keepOverlap(buffer, chunkOverlap);
      buffer = buffer ? `${buffer}\n${line}` : line;
    } else {
      buffer = candidate;
    }
  }

  pushChunk(buffer);

  return chunks;
}
