/**
 * 管理员角色迁移（幂等）
 *
 * 1. users 表增加 role 字段（默认 'user'）
 * 2. 把系统第一个用户（即初始化时的默认管理员）与用户名为 admin 的用户设为 'admin'
 *
 * 运行: node scripts/migrate-admin-role.js
 */

const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';`
    );

    // 第一个创建的用户（即迁移 auth 时创建的默认管理员）设为 admin
    await pool.query(
      `UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);`
    );
    // 兼容：用户名为 admin 的也确保是管理员
    await pool.query(
      `UPDATE users SET role = 'admin' WHERE username = 'admin' AND role = 'user';`
    );

    const { rows } = await pool.query(
      `SELECT username, role FROM users ORDER BY created_at ASC;`
    );
    console.log('用户角色列表:');
    for (const r of rows) console.log(`  ${r.username} -> ${r.role}`);
  } catch (err) {
    console.error('管理员角色迁移失败:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
