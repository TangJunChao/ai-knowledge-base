/**
 * Embedding 生成工具（本地模型方案）
 * 使用 @xenova/transformers 本地运行，无需 API Key
 * 模型: Xenova/bge-small-zh-v1.5 (512 维，适合中文)
 */

import { pipeline, env } from '@xenova/transformers';

// 使用国内镜像下载模型
env.allowRemoteModels = true;
env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com';
env.localModelPath = './.models';

const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';
export const EMBEDDING_DIMENSIONS = 512;

let embedder: any = null;

async function getEmbedder() {
  if (!embedder) {
    console.log('Loading embedding model from', env.remoteHost, '(first time downloads the model)...');
    embedder = await pipeline('feature-extraction', MODEL_NAME);
    console.log('Embedding model loaded successfully.');
  }
  return embedder;
}

/**
 * 生成单条文本的 Embedding
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * 批量生成多条文本的 Embedding
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor = await getEmbedder();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i++) {
    const output = await extractor(texts[i], { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data as Float32Array));
  }

  return results;
}

/**
 * 将向量数组转换为 PostgreSQL pgvector 格式的字符串
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
