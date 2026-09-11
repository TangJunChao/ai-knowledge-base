// Test with Seq Scan (no index)
const { Pool } = require('pg');

async function test() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const transformers = await import('@xenova/transformers');
  const t = transformers.default || transformers;
  t.env.remoteHost = 'https://hf-mirror.com';
  t.env.allowRemoteModels = true;
  t.env.localModelPath = './.models';

  const pipe = await t.pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
  const out = await pipe('React Hooks', { pooling: 'mean', normalize: true });
  const emb = Array.from(out.data);
  const vecStr = '[' + emb.join(',') + ']';

  // Force sequential scan (no index)
  console.log('1. With SET enable_seqscan...');
  await pool.query('SET enable_seqscan = on');
  await pool.query('SET enable_indexscan = off');
  const r1 = await pool.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM document_chunks ORDER BY embedding <=> $1::vector LIMIT 5`,
    [vecStr]
  );
  console.log('   Results:', r1.rows.length);
  r1.rows.forEach((row, i) => console.log(`   ${i+1}. sim=${row.sim} id=${row.id}`));

  // Check EXPLAIN
  console.log('2. EXPLAIN query...');
  await pool.query('SET enable_indexscan = on');
  const r2 = await pool.query(
    `EXPLAIN SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM document_chunks ORDER BY embedding <=> $1::vector LIMIT 5`,
    [vecStr]
  );
  r2.rows.forEach(row => console.log('   ', row['QUERY PLAN']));

  // Drop the IVFFlat index and retry
  console.log('3. Dropping IVFFlat index...');
  await pool.query('DROP INDEX IF EXISTS document_chunks_embedding_idx');
  console.log('   Dropped.');

  const r3 = await pool.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM document_chunks ORDER BY embedding <=> $1::vector LIMIT 5`,
    [vecStr]
  );
  console.log('   Results after dropping index:', r3.rows.length);
  r3.rows.forEach((row, i) => console.log(`   ${i+1}. sim=${row.sim} id=${row.id}`));

  // Recreate with HNSW index
  console.log('4. Creating HNSW index...');
  await pool.query('CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops)');
  console.log('   HNSW index created.');

  const r4 = await pool.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM document_chunks ORDER BY embedding <=> $1::vector LIMIT 5`,
    [vecStr]
  );
  console.log('   Results with HNSW:', r4.rows.length);
  r4.rows.forEach((row, i) => console.log(`   ${i+1}. sim=${row.sim} id=${row.id}`));

  await pool.end();
}

test().catch(e => {
  console.error('Error:', e.message);
  console.error(e.stack);
});
