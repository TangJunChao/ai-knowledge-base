/**
 * 预下载/加载本地 Embedding 模型（供 Docker 构建时离线缓存模型）。
 * 运行: node scripts/download-model.js
 */
const { pipeline, env } = require('@xenova/transformers');

env.allowRemoteModels = true;
env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com';
env.localModelPath = './.models';

async function main() {
  console.log('下载/加载 embedding 模型: Xenova/bge-small-zh-v1.5 ...');
  await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
  console.log('模型就绪，已缓存到 ./.models');
}

main().catch((e) => {
  console.error('模型下载失败:', e.message);
  process.exit(1);
});
