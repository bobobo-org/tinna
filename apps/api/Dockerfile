# syntax=docker/dockerfile:1
# 緣舍命理 API（Railway）
#
# build context = repo 根目錄：
#   docker build -f apps/api/Dockerfile -t yuanshe-api .
#   docker run --rm -p 8080:8080 -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -e WEB_URL=... -e API_URL=... yuanshe-api
# Railway：服務變數 RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile，Root Directory 留空（repo 根目錄），
#          Healthcheck Path /health。

ARG NODE_VERSION=22

# ---------- build ----------
FROM node:${NODE_VERSION}-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack 依 root package.json 的 packageManager（pnpm@10.33.0）取得同版本 pnpm
RUN corepack enable
WORKDIR /repo

# 先只拷貝相依清單，pnpm install 這一層可以被快取
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...

# 整個 apps/api（CI 寫入的 BUILD_SHA 若存在也會一起進來）
COPY apps/api/ apps/api/
RUN pnpm --filter api build

# 組出最終映像需要的檔案：正式相依（pnpm deploy --prod）、dist、package.json（"type": "module"）、BUILD_SHA（選用）
RUN pnpm --filter api deploy --legacy --prod /tmp/deploy \
 && mkdir -p /out \
 && mv /tmp/deploy/node_modules /out/node_modules \
 && cp apps/api/package.json /out/package.json \
 && cp -R apps/api/dist /out/dist \
 && if [ -f apps/api/BUILD_SHA ]; then cp apps/api/BUILD_SHA /out/BUILD_SHA; fi

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
# /out 一定存在，BUILD_SHA 不存在也不會讓 COPY 失敗；/health 讀 /app/BUILD_SHA
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
