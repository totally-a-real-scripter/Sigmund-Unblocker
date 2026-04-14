# ---------- BUILD STAGE ----------
FROM node:22-alpine AS builder

WORKDIR /app/backend

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# System deps (needed for native modules / builds)
RUN apk add --no-cache \
  git \
  bash \
  python3 \
  make \
  g++ \
  libc6-compat

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Copy dependency files first (better caching)
COPY backend/package.json ./
COPY backend/pnpm-lock.yaml* ./
COPY backend/.npmrc* ./

# Install dependencies (ALLOW scripts)
RUN pnpm install --no-frozen-lockfile

# ❌ Remove problematic package AFTER install (prevents wasm/cargo failure)
RUN pnpm remove @mercuryworkshop/scramjet || true

# Copy full source
COPY backend/ ./

# ---------- RUNTIME STAGE ----------
FROM node:22-alpine

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Copy built app + node_modules from builder
COPY --from=builder /app/backend ./

# Keep only production deps
RUN pnpm prune --prod

# Optional: fix DNS issues (only if your platform is broken)
# RUN echo "nameserver 8.8.8.8" > /etc/resolv.conf

EXPOSE 3001

CMD ["node", "src/server.js"]
