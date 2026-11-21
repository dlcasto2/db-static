# Devon and its proxy backend in one container: builds the static site, then
# runs server/index.mjs, which serves it at /db-static/ alongside the Bare
# (/bare/) and Wisp (/wisp/) servers. Build from the repo root:
#   docker build -f server/Dockerfile -t devon .
#   docker run -p 8080:8080 devon      # then open http://localhost:8080/
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/index.mjs ./server/
COPY --from=build /app/out ./out
ENV PORT=8080
EXPOSE 8080
# Node reads at most 16 KB of response headers by default; YouTube and other
# big sites send more, which the Bare server would fail on ("Header overflow")
CMD ["node", "--max-http-header-size=262144", "server/index.mjs"]
