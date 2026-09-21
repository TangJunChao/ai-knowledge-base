/**
 * OCR 图片文字识别（可选功能，通过 ENABLE_OCR=1 开启）
 *
 * 设计原则：
 * - 按需触发：仅当文档包含图片时才执行 OCR；纯文本文档解析路径不变，耗时几乎无增加
 * - 数量/尺寸限制：OCR_MAX_IMAGES（默认 20）限制总图片数，单张渲染像素超过
 *   OCR_MAX_PIXELS（默认 900 万）时跳过，避免超大图片拖慢解析或耗尽内存
 * - 失败静默：OCR 任何异常都返回空结果，绝不影响主解析流程
 *
 * 支持：
 * - PDF：用 pdfjs-dist 渲染"含图片的页面"为 PNG 后交给 Tesseract OCR
 * - Word(.docx)：用 mammoth 提取内嵌图片 buffer 后交给 Tesseract OCR
 * - Excel(.xlsx)：xlsx 本质是 zip 包，用 adm-zip 解压读取 xl/media/ 下的图片后交给 Tesseract OCR
 */

import path from 'path';
import { createWorker, type Worker } from 'tesseract.js';

/** OCR 是否开启（ENABLE_OCR=1 / true / yes） */
export function ocrEnabled(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.ENABLE_OCR || '').toLowerCase());
}

function ocrMaxImages(): number {
  const v = parseInt(process.env.OCR_MAX_IMAGES || '20', 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

function ocrMaxPixels(): number {
  const v = parseInt(process.env.OCR_MAX_PIXELS || '9000000', 10);
  return Number.isFinite(v) && v > 0 ? v : 9000000;
}

/** 语言包目录（Docker 部署时随 scripts 目录一并复制） */
function langDataDir(): string {
  return path.join(process.cwd(), 'scripts', 'lang-data');
}

// 复用全局 worker：语言包加载（约 0.3s）仅一次，之后 OCR 请求串行复用
let workerPromise: Promise<Worker> | null = null;
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['chi_sim', 'eng'], 1, {
      langPath: langDataDir(),
      gzip: false,
    });
  }
  return workerPromise;
}

/** 单张图片 OCR 的文本（识别失败返回空串） */
async function recognizeImage(worker: Worker, image: Buffer): Promise<string> {
  try {
    const { data } = await worker.recognize(image);
    return (data.text || '').trim();
  } catch {
    return '';
  }
}

/**
 * PDF 图片 OCR：渲染每个"含图片的页面"为 PNG 并识别。
 * 返回 [{ pageNo, text }]；未启用 OCR 或失败时返回空数组。
 */
export async function ocrPdfImages(
  buffer: Buffer
): Promise<{ pageNo: number; text: string }[]> {
  if (!ocrEnabled()) return [];
  try {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
      getDocument: (opts: Record<string, unknown>) => { promise: Promise<any>; destroy: () => Promise<void> };
      OPS: { paintImageXObject: number; paintInlineImageXObject: number };
    };
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvasFactory = {
      create(w: number, h: number) {
        const canvas = createCanvas(w, h);
        return { canvas, context: canvas.getContext('2d') };
      },
      reset(ctx: { canvas: { width: number; height: number } }, w: number, h: number) {
        ctx.canvas.width = w;
        ctx.canvas.height = h;
      },
      destroy(ctx: { canvas: unknown }) {
        ctx.canvas = null;
      },
    };

    // pdfjs 的标准字体数据目录（v6 渲染必需）
    const pkgDir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
    const standardFontDataUrl =
      'file://' + path.join(pkgDir, 'standard_fonts').replace(/\\/g, '/') + '/';

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      canvasFactory,
      standardFontDataUrl,
    });
    const doc = await loadingTask.promise;
    const worker = await getWorker();

    const maxImages = ocrMaxImages();
    const maxPixels = ocrMaxPixels();
    const out: { pageNo: number; text: string }[] = [];

    for (let n = 1; n <= doc.numPages; n++) {
      if (out.length >= maxImages) break;
      const page = await doc.getPage(n);

      // 仅处理含图片的页面：扫描件整页也是一张大图（paintImageXObject）
      const opList = await page.getOperatorList();
      let hasImage = false;
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
          hasImage = true;
          break;
        }
      }
      if (!hasImage) continue;

      const viewport = page.getViewport({ scale: 2 });
      if (viewport.width * viewport.height > maxPixels) continue;

      const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const text = await recognizeImage(worker, canvas.toBuffer('image/png'));
      if (text) out.push({ pageNo: n, text });
    }

    await loadingTask.destroy();
    return out;
  } catch (error) {
    console.warn('OCR PDF failed:', error);
    return [];
  }
}

/**
 * Word(.docx) 图片 OCR：用 mammoth 提取内嵌图片并识别。
 * 返回 OCR 文本（多张图片文本以换行连接）；未启用/失败返回空串。
 */
export async function ocrDocxImages(buffer: Buffer): Promise<string> {
  if (!ocrEnabled()) return '';
  try {
    const mammoth = (await import('mammoth')) as typeof import('mammoth') & {
      images: {
        imgElement: (
          fn: (image: { read: () => Promise<Buffer> }) => unknown
        ) => unknown;
      };
    };
    const worker = await getWorker();

    const images: Buffer[] = [];
    const maxImages = ocrMaxImages();
    await mammoth.convertToHtml({ buffer }, {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const buf = await image.read();
          if (images.length < maxImages) images.push(buf);
        } catch {
          // 单个图片读取失败不影响其余
        }
        return { src: '' };
      }),
    });

    const parts: string[] = [];
    for (const img of images) {
      const text = await recognizeImage(worker, img);
      if (text) parts.push(text);
    }
    return parts.join('\n');
  } catch (error) {
    console.warn('OCR DOCX failed:', error);
    return '';
  }
}

/**
 * Excel(.xlsx) 图片 OCR：xlsx 本质是 zip 包，用 adm-zip 解压读取
 * xl/media/ 目录下的图片资源后交给 Tesseract OCR。
 * 返回 OCR 文本（多张图片文本以换行连接）；未启用/失败返回空串。
 */
export async function ocrXlsxImages(buffer: Buffer): Promise<string> {
  if (!ocrEnabled()) return '';
  try {
    const AdmZip = (await import('adm-zip')).default as new (data: Buffer) => {
      getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[];
    };
    const zip = new AdmZip(buffer);
    const maxImages = ocrMaxImages();

    // 只取 xl/media/ 下的图片资源（浮动图片/图表截图等存放于此）
    const images: Buffer[] = [];
    for (const entry of zip.getEntries()) {
      if (images.length >= maxImages) break;
      const name = entry.entryName.replace(/\\/g, '/');
      if (!name.startsWith('xl/media/')) continue;
      if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(name)) continue;
      if (entry.isDirectory) continue;
      images.push(entry.getData());
    }

    const worker = await getWorker();
    const parts: string[] = [];
    for (const img of images) {
      const text = await recognizeImage(worker, img);
      if (text) parts.push(text);
    }
    return parts.join('\n');
  } catch (error) {
    console.warn('OCR XLSX failed:', error);
    return '';
  }
}
