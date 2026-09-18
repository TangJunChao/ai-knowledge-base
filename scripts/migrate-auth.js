/**
 * 登录与多用户隔离迁移（幂等）
 *
 * 1. 创建 users 表
 * 2. documents / conversations / chat_history 增加 user_id 列（外键，级联删除）
 * 3. 若 users 表为空，创建默认管理员 admin（密码默认 admin123，可在 .env 用 ADMIN_PASSWORD 覆盖）
 * 4. 存量数据（原无主）统一归给该用户，避免旧数据丢失
 *
 * 运行: node scripts/migrate-auth.js
 */

const { Pool } = require('pg');
const { scryptSync, randomBytes } = require('crypto');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    // 1. users 表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. 业务表加 user_id（幂等）
    await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;`);
    await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;`);
    await pool.query(`ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;`);

    // 索引
    await pool.query(`CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS chat_history_user_id_idx ON chat_history(user_id);`);

    // 3. 默认用户
    const { rows: userRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users;`);
    if (userRows[0].n === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      await pool.query(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)`,
        [username, hashPassword(password)]
      );
      console.log(`已创建默认用户：${username}（密码：${password}，请尽快登录后注意保管）`);
    }

    // 4. 存量数据归给默认用户（取第一个用户作为归属）
    const { rows: ownerRows } = await pool.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1;`);
    if (ownerRows.length > 0) {
      const ownerId = ownerRows[0].id;
      await pool.query(`UPDATE documents SET user_id = $1 WHERE user_id IS NULL;`, [ownerId]);
      await pool.query(`UPDATE conversations SET user_id = $1 WHERE user_id IS NULL;`, [ownerId]);
      // chat_history：优先继承所属会话的归属，其次归默认用户
      await pool.query(`
        UPDATE chat_history h SET user_id = COALESCE(
          (SELECT c.user_id FROM conversations c WHERE c.id = h.conversation_id),
          $1
        )
        WHERE h.user_id IS NULL;`, [ownerId]);
      console.log(`存量数据已归属到用户 ${ownerId}`);
    }

    console.log('认证迁移完成');
  } catch (err) {
    console.error('认证迁移失败:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
