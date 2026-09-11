// Test retrieveContext from rag.ts directly
const { Pool } = require('pg');

async function testRetrieve() {
  const transformers = await import('@xenova/transformers');
  const t = transformers.default || transformers;
  t.env.remoteHost = 'https://hf-mirror.com';
  t.env.allowRemoteModels = true;
  t.env.localModelPath = './.models';

  console.log('Loading model...');
  const pipe = await t.pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
  const out = await pipe('React有哪些常用Hooks?', { pooling: 'mean', normalize: true });
  const emb = Array.from(out.data);
  console.log('Embedding dim:', emb.length);

  const vec = '[' + emb.join(',') + ']';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('Querying database...');
  const r = await pool.query(
    `SELECT dc.id, dc.content, dc.chunk_index, dc.document_id, d.title,
            1 - (dc.embedding <=> $1::vector) AS similarity
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE dc.embedding IS NOT NULL
     ORDER BY dc.embedding <=> $1::vector
     LIMIT 5`,
    [vec]
  );

  console.log('Results:', r.rows.length);
  r.rows.forEach((row, i) => {
    console.log(`${i+1}. sim=${row.similarity.toFixed(4)} title=${row.title}`);
    console.log(`   content: ${row.content.substring(0, 100)}...`);
  });

  await pool.end();
}

testRetrieve().catch(e => {
  console.error('Error:', e.message);
  console.error(e.stack);
});
