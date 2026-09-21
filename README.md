# AI 知识库问答系统

基于上传文档的本地智能问答系统。支持语义检索问答、表格精确统计、最新记录查询、多会话管理，Docker 一键部署，数据全部保存在本地。

## 功能特性

- 智能问答：基于知识库文档的 RAG 语义检索问答，回答标注引用来源
- 登录与多用户隔离：用户注册 / 登录认证（JWT + httpOnly Cookie，密码加盐哈希）；文档、会话、历史数据按用户严格隔离，无法查看或操作他人数据，防止误删他人文档；管理员（默认 admin）可在"用户管理"页重置密码、删除或批量删除用户（级联删除其数据，不能删自己/管理员）
- 表格统计：合计 / 平均 / 多少家 / 按月分组等由程序精确计算，不依赖检索召回，并生成图表
- 最新记录查询：按月份时间排序精确取某对象最新一条记录（如"美味居最新租金多少"）
- 多轮追问：结合对话历史自动改写查询，支持"那 2026 年呢？"这类追问
- 追问建议：回答完成后自动推荐 2-3 个相关追问，点击即可继续深入提问
- 多会话管理：左侧会话栏支持新建 / 切换 / 删除 / 重命名会话，首条问题自动命名，历史按会话分组展示，活跃会话自动置顶
- 文档管理：支持 PDF / Word / Excel / CSV / Markdown / TXT / HTML 上传、覆盖更新、删除（均带二次确认）；可选 OCR（ENABLE_OCR=1）自动识别 PDF / Word / Excel 内图片文字
- 流式输出：打字机效果，可随时停止（已生成内容保留不丢失），生成过程中实时渲染 Markdown，可向上滚动查看历史
- 答案导出：一键复制 Markdown / 导出 .md / 导出 PDF 文件；统计问答的柱状图可一并导出（PDF 内嵌图表，MD 附数据表格与图表图片）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 14、TypeScript、Tailwind CSS |
| 后端 | Next.js API Routes、AI SDK |
| 大模型 | DeepSeek（deepseek-chat，OpenAI 兼容接口） |
| 向量检索 | PostgreSQL + pgvector（HNSW 索引） |
| 本地 Embedding | @xenova/transformers（bge-small-zh-v1.5，无需 API Key） |

## 快速开始（Docker 一键部署，推荐）

前置条件：安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，准备一个 [DeepSeek API Key](https://platform.deepseek.com/)。

```bash
# 1. 获取代码
git clone https://github.com/TangJunChao/ai-knowledge-base.git
cd ai-knowledge-base

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，把 OPENAI_API_KEY 换成你自己的 DeepSeek Key

# 3. 构建并启动（首次约 5-10 分钟）
docker compose up -d --build

# 4. 浏览器打开
# http://localhost:3000
```

Windows 用户可直接双击 `start.bat`，脚本会自动检查 Docker、构建并打开浏览器。

首次启动默认管理员账号：`admin` / `admin123`（可在 `.env` 中通过 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 修改；登录后即可注册其他用户，各用户数据相互隔离）。

## 本地开发

前置条件：Node.js 18+、PostgreSQL（需启用 pgvector 扩展）。

```bash
npm install

# 配置 .env 中的 DATABASE_URL，例如：
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_knowledge_base

# 初始化数据库表（含 pgvector 向量列）
npm run db:migrate

# 启动开发服务器
npm run dev
```

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | 必填 |
| `OPENAI_API_KEY` | DeepSeek API Key | 必填 |
| `OPENAI_BASE_URL` | 大模型接口地址 | `https://api.deepseek.com/v1` |
| `CHAT_MODEL` | 对话模型 | `deepseek-chat` |
| `HF_ENDPOINT` | HuggingFace 镜像（本地模型下载） | `https://hf-mirror.com` |
| `CHUNK_SIZE` | 分块大小（字符） | `800` |
| `CHUNK_OVERLAP` | 分块重叠 | `200` |
| `TOP_K` | 向量检索片段数 | `15` |
| `KEYWORD_TOP_K` | 关键词检索补充片段数 | `30` |
| `MAX_CONTEXT_CHUNKS` | 送入模型的最大片段数 | `30` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | 仅在网络代理拦截证书时设 `0` | 未设置 |
| `ENABLE_OCR` | 开启 OCR 图片文字识别（PDF/Word/Excel 内图片转文字，见下方说明） | 未设置 |
| `OCR_MAX_IMAGES` | 单文档最多 OCR 的图片数 | `20` |
| `OCR_MAX_PIXELS` | 单张图片渲染像素上限，超限跳过 | `9000000` |

## 使用示例

在对话页提问：

- "美味居最新租金多少" —— 返回最新一条记录（最新记录查询）
- "A102 在 2025-2026 年的收租情况，请按月列出" —— 返回按月统计表与图表
- "2025 年 12 月所有租户的水费合计是多少" —— 精确聚合统计
- "这个文档的核心观点是什么" —— 语义检索问答

## 项目结构

```
├── app/                  # Next.js 页面与 API 路由
│   └── api/
│       ├── chat/         # 问答接口（统计 / 最新记录 / RAG / 追问建议）
│       ├── conversations/# 会话管理（列表 / 详情 / 重命名 / 删除）
│       ├── upload/       # 文档上传与覆盖更新
│       ├── documents/    # 文档列表与删除
│       └── history/      # 聊天历史
├── components/           # 聊天、会话栏、文档、历史、图表等组件
├── lib/                  # 核心逻辑
│   ├── rag.ts            # 检索、Prompt 组装、入库、会话管理
│   ├── suggestions.ts    # 追问建议生成
│   ├── statistics.ts     # 统计引擎与最新记录查询
│   ├── file-parsers.ts   # PDF / Word / Excel 解析（结构化表格）
│   ├── ocr.ts            # 可选 OCR：PDF 页面渲染 / Word·Excel 图片提取 + 文字识别
│   ├── chunking.ts       # 行级分块（不切断表格记录）
│   └── embeddings.ts     # 本地向量模型
├── scripts/              # 数据库初始化、模型预下载、迁移脚本
├── Dockerfile            # 多阶段构建（含模型预置）
├── docker-compose.yml    # 一键编排（数据库 + 应用）
└── start.bat             # Windows 一键启动
```

## 常见问题

**提问后报错 `unable to verify the first certificate`**
网络被代理拦截导致证书校验失败。编辑 `.env`，取消最后一行注释 `NODE_TLS_REJECT_UNAUTHORIZED=0` 后重启服务。仅此场景需要，正常网络请勿开启。

**想换访问端口**
编辑 `docker-compose.yml`，把 `"3000:3000"` 改为 `"8080:3000"`，之后访问 `http://localhost:8080`。

**如何备份数据**
```bash
docker compose exec db pg_dump -U postgres ai_knowledge_base > backup.sql
```

**如何更新代码**
```bash
git pull
docker compose up -d --build
```

## 许可证

本项目为私有项目，未指定开源许可证。
