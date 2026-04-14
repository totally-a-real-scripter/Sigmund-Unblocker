# ---------- BUILD STAGE ----------
FROM node:22-alpine AS builder

WORKDIR /app/backend

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apk add --no-cache \
  git \
  bash \
  python3 \
  make \
  g++ \
  libc6-compat

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY backend/package.json ./
COPY backend/pnpm-lock.yaml* ./
COPY backend/.npmrc* ./

# 🚫 Block ALL scripts (prevents scramjet WASM build)
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# ✅ Rebuild ONLY the package that needs it
RUN pnpm rebuild @mercuryworkshop/epoxy-transport

COPY backend/ ./

# ---------- RUNTIME ----------
FROM node:22-alpine

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend ./

RUN pnpm prune --prod

EXPOSE 3001

CMD ["node", "src/server.js"]
