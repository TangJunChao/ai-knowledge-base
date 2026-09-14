/**
 * 多会话迁移脚本（幂等，不删除任何已有数据）
 *
 * 功能：
 * 1. 创建 conversations 会话表
 * 2. 给 chat_history 增加 conversation_id 外键列
 * 3. 将历史遗留的"无会话"记录按天分组归入会话（标题如 "9月10日 对话"）
 *
 * 运行: node scripts/migrate-conversations.js
 */

const { Pool } = require('pg');

const schema = `
-- 会话表
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL DEFAULT '新对话',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 对话历史增加会话外键（幂等）
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;

-- 会话更新时间索引
CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations(updated_at DESC);

-- 历史记录按会话查询索引
CREATE INDEX IF NOT EXISTS chat_history_conversation_id_idx ON chat_history(conversation_id, created_at);
`;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    console.log('1/3 创建会话表与列...');
    await pool.query(schema);
    console.log('   完成');

    // 找出所有还没有会话归属的历史记录
    const { rows: orphans } = await pool.query(
      `SELECT id, created_at FROM chat_history WHERE conversation_id IS NULL ORDER BY created_at`
    );
    console.log(`2/3 发现 ${orphans.length} 条历史记录需要归组...`);

    if (orphans.length > 0) {
      // 按自然日分组
      const groups = new Map(); // key: 'YYYY-MM-DD' -> { ids: [], created_at: Date }
      for (const row of orphans) {
        const day = new Date(row.created_at).toISOString().slice(0, 10);
        if (!groups.has(day)) groups.set(day, { ids: [], createdAt: new Date(row.created_at) });
        const g = groups.get(day);
        g.ids.push(row.id);
        if (new Date(row.created_at) < g.createdAt) g.createdAt = new Date(row.created_at);
      }

      let created = 0;
      for (const [day, g] of groups.entries()) {
        const date = new Date(day + 'T00:00:00Z');
        const title = `${date.getMonth() + 1}月${date.getDate()}日 对话`;
        const conv = await pool.query(
          `INSERT INTO conversations (title, created_at, updated_at) VALUES ($1, $2, $2) RETURNING id`,
          [title, g.createdAt]
        );
        const convId = conv.rows[0].id;
        // 分批更新（防止参数过多）
        const chunkSize = 100;
        for (let i = 0; i < g.ids.length; i += chunkSize) {
          const chunk = g.ids.slice(i, i + chunkSize);
          await pool.query(
            `UPDATE chat_history SET conversation_id = $1 WHERE id = ANY($2::uuid[])`,
            [convId, chunk]
          );
        }
        created++;
      }
      console.log(`   已创建 ${created} 个会话并归组 ${orphans.length} 条记录`);
    }

    // 若存在"新对话"默认标题（无任何消息的），清理为占位标题避免混淆
    await pool.query(
      `DELETE FROM conversations
       WHERE title = '新对话'
         AND NOT EXISTS (SELECT 1 FROM chat_history h WHERE h.conversation_id = conversations.id)`
    );

    console.log('3/3 迁移完成');
    const stats = await pool.query(
      `SELECT COUNT(*)::int AS conversations, (SELECT COUNT(*)::int FROM chat_history) AS messages
       FROM conversations`
    );
    console.log(`   当前会话数: ${stats.rows[0].conversations}，消息数: ${stats.rows[0].messages}`);
  } catch (err) {
    console.error('迁移失败:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
