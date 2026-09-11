// Test with hardcoded short vector
const { Pool } = require('pg');

async function test() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // First check the vector dimension in the DB
  const r0 = await pool.query("SELECT vector_dims(embedding) as dims FROM document_chunks LIMIT 1");
  console.log('DB vector dimensions:', r0.rows[0].dims);

  // Try a simple query with a 512-dim vector of zeros
  const zeros = Array(512).fill(0).join(',');
  const r1 = await pool.query(
    `SELECT id, 1 - (embedding <=> '[${zeros}]'::vector) AS sim FROM document_chunks LIMIT 3`
  );
  console.log('Zero vector results:', r1.rows.length);
  r1.rows.forEach((row, i) => console.log(`  ${i+1}. sim=${row.sim} id=${row.id}`));

  // Try with a real embedding
  const transformers = await import('@xenova/transformers');
  const t = transformers.default || transformers;
  t.env.remoteHost = 'https://hf-mirror.com';
  t.env.allowRemoteModels = true;
  t.env.localModelPath = './.models';

  const pipe = await t.pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
  const out = await pipe('React Hooks', { pooling: 'mean', normalize: true });
  const emb = Array.from(out.data);
  const vecStr = '[' + emb.join(',') + ']';

  // Pass as string, let pg cast it
  const r2 = await pool.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM document_chunks ORDER BY embedding <=> $1::vector LIMIT 3`,
    [vecStr]
  );
  console.log('Real embedding results:', r2.rows.length);
  r2.rows.forEach((row, i) => console.log(`  ${i+1}. sim=${row.sim} id=${row.id}`));

  await pool.end();
}

test().catch(e => {
  console.error('Error:', e.message);
  console.error(e.stack);
});
