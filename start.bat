@echo off
chcp 65001 >nul
title 知识库问答系统 - 一键启动
echo ============================================
echo        知识库问答系统  一键启动
echo ============================================
echo.

rem ---- 1. 检查 .env 是否存在 ----
if not exist .env (
  echo [提示] 未找到 .env 配置文件，正在从模板创建...
  copy .env.example .env >nul
  echo [注意] 请编辑 .env 文件，把 OPENAI_API_KEY 换成你自己的 DeepSeek API Key
  echo        获取地址: https://platform.deepseek.com/
  echo.
  pause
  exit /b 1
)

rem ---- 2. 检查 API Key 是否已配置 ----
findstr /C:"sk-" .env >nul 2>&1
if errorlevel 1 (
  echo [警告] .env 中未检测到有效的 API Key (sk-...)
  echo        请编辑 .env 文件，将 OPENAI_API_KEY 设置为你的 DeepSeek Key
  echo.
  pause
  exit /b 1
)

rem ---- 3. 检查 Docker ----
echo [检查] 正在检查 Docker 环境...
docker info >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Docker，请先安装并启动 Docker Desktop
  echo        下载地址: https://www.docker.com/products/docker-desktop/
  echo.
  pause
  exit /b 1
)
echo [OK] Docker 环境正常

rem ---- 4. 构建并启动 ----
echo.
echo [启动] 正在构建镜像并启动服务（首次约需 5-10 分钟）...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo [错误] 启动失败，请查看上方日志
  pause
  exit /b 1
)

rem ---- 5. 等待服务就绪并打开浏览器 ----
echo.
echo [完成] 服务已启动！正在打开浏览器...
timeout /t 3 /nobreak >nul
start http://localhost:3000
echo.
echo 日常操作：
echo   启动:   双击本文件
echo   停止:   docker compose down
echo   停止并清空数据: docker compose down -v
echo.
pause
