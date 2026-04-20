# syntax=docker/dockerfile:1.7
# Multi-stage build for @agorap2p/seed.
# Build: docker build -t agora-seed packages/seed
# Run:   docker run --rm -it -v agora-seed:/data -p 9876:9876 agora-seed --seed-all --tui

FROM node:22-bookworm-slim AS builder
WORKDIR /app
# node-datachannel ships prebuilds for linux-x64/arm64; build tools are the fallback path.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ cmake git \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund \
    && npm cache clean --force

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r agora && useradd -r -g agora -m -d /home/agora agora \
    && mkdir -p /data && chown agora:agora /data
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY README.md package.json ./
USER agora
VOLUME ["/data"]
EXPOSE 9876
ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--", "node", "src/index.mjs"]
CMD ["--seed-all", "--data", "/data"]
