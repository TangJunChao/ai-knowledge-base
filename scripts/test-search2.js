// Debug vector search step by step
const { Pool } = require('pg');

async function debug() {
  const transformers = await import('@xenova/transformers');
  const t = transformers.default || transformers;
  t.env.remoteHost = 'https://hf-mirror.com';
  t.env.allowRemoteModels = true;
  t.env.localModelPath = './.models';

  console.log('1. Loading model...');
  const pipe = await t.pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');

  console.log('2. Generating embedding...');
  const out = await pipe('React有哪些常用Hooks?', { pooling: 'mean', normalize: true });
  const emb = Array.from(out.data);
  console.log('   dim:', emb.length, 'first 5:', emb.slice(0, 5));

  const vec = '[' + emb.join(',') + ']';
  console.log('3. Vector string length:', vec.length);
  console.log('   Vector preview:', vec.substring(0, 80));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Test 1: count all chunks
  const r1 = await pool.query('SELECT count(*) FROM document_chunks');
  console.log('4. Total chunks:', r1.rows[0].count);

  // Test 2: simple distance query
  console.log('5. Testing simple distance query...');
  const r2 = await pool.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS sim
     FROM document_chunks
     ORDER BY embedding <=> $1::vector
     LIMIT 3`,
    [vec]
  );
  console.log('   Results:', r2.rows.length);
  r2.rows.forEach((row, i) => {
    console.log(`   ${i+1}. sim=${row.sim} id=${row.id}`);
  });

  // Test 3: with JOIN
  console.log('6. Testing with JOIN...');
  const r3 = await pool.query(
    `SELECT dc.id, d.title, 1 - (dc.embedding <=> $1::vector) AS sim
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     ORDER BY dc.embedding <=> $1::vector
     LIMIT 3`,
    [vec]
  );
  console.log('   Results:', r3.rows.length);
  r3.rows.forEach((row, i) => {
    console.log(`   ${i+1}. sim=${row.sim} title=${row.title}`);
  });

  await pool.end();
}

debug().catch(e => {
  console.error('Error:', e.message);
  console.error(e.stack);
});
