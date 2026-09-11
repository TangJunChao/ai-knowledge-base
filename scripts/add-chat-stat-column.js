/**
 * 增量迁移：为 chat_history 表添加 stat_data 列（存储统计问答的图表数据）
 * 运行: node scripts/add-chat-stat-column.js
 *
 * 幂等：已存在该列时不会重复添加，不会影响已有数据。
 */

const { Pool } = require('pg');

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL is not set. Please configure your .env file.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    console.log('Connecting to database...');

    // 幂等添加 stat_data 列（JSONB，保存统计问答的结构化分组数据用于图表渲染）
    await client.query(`
      ALTER TABLE chat_history
        ADD COLUMN IF NOT EXISTS stat_data JSONB
    `);
    console.log('Column "stat_data" is ready.');

    client.release();
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();