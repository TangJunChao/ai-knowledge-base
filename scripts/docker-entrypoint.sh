#!/bin/sh
# 应用容器启动入口：先初始化数据库，再启动 Next.js
set -e

echo "[init] 初始化数据库..."
node scripts/init-db.js

echo "[init] 启动应用..."
exec "$@"
