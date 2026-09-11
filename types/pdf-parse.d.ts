/**
 * pdf-parse 没有内置类型声明，这里补充最小可用声明。
 * 仅覆盖项目实际用到的 default 导出（接收 Buffer，返回解析结果）。
 */
declare module 'pdf-parse' {
  interface PDFParseResult {
    /** 全文文本 */
    text: string;
    /** 总页数 */
    numpages: number;
    /** 文档信息 */
    info: Record<string, unknown>;
    /** 元数据 */
    metadata: unknown;
    /** 版本 */
    version: string;
  }

  interface PDFParseOptions {
    /** 页码范围，如 { first: 1, last: 10 } */
    pagerender?: (pageData: unknown) => string | Promise<string>;
    max?: number;
    version?: string;
  }

  function pdfParse(
    data: Buffer | Uint8Array | ArrayBuffer,
    options?: PDFParseOptions
  ): Promise<PDFParseResult>;

  export default pdfParse;
}
