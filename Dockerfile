# ==============================================
# 知识库问答系统 - Docker 镜像
# 多阶段构建：依赖 → 构建 + 模型缓存 → 运行时
# ==============================================
# Node 22 LTS：pdfjs-dist v6（OCR 用）要求 Node >= 22.13
FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- 阶段1：安装依赖 ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

# ---- 阶段2：构建应用 + 预下载模型 ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建 Next.js 生产产物
RUN npm run build
# 预下载本地 Embedding 模型，运行时离线可用（镜像会变大，但首次启动秒开）
ENV HF_ENDPOINT=https://hf-mirror.com
RUN node scripts/download-model.js

# ---- 阶段3：运行时 ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/.models ./.models
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 3000
ENTRYPOINT ["sh", "scripts/docker-entrypoint.sh"]
CMD ["node_modules/.bin/next", "start"]
