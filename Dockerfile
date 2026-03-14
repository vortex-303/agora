FROM node:22-slim AS builder
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/relay/package.json packages/relay/
RUN pnpm install --frozen-lockfile
COPY packages/core/ packages/core/
COPY packages/relay/ packages/relay/
RUN pnpm --filter @agora/core build && pnpm --filter @agora/relay build

FROM node:22-slim
RUN npm install -g pnpm@10
WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist/ packages/core/dist/
COPY --from=builder /app/packages/relay/package.json packages/relay/
COPY --from=builder /app/packages/relay/dist/ packages/relay/dist/
RUN pnpm install --frozen-lockfile --prod
EXPOSE 9800
ENV PORT=9800
ENV DATA_DIR=/data
CMD ["node", "packages/relay/dist/index.js"]
