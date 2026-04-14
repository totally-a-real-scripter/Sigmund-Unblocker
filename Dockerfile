# ---------- BUILD STAGE ----------
FROM node:22-alpine AS builder

WORKDIR /app/backend

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# System deps
RUN apk add --no-cache \
  git \
  bash \
  python3 \
  make \
  g++ \
  libc6-compat

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Copy only dependency files first (for caching)
COPY backend/package.json ./
COPY backend/pnpm-lock.yaml* ./
COPY backend/.npmrc* ./

# 🚫 Disable ALL lifecycle scripts (this is the KEY fix)
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Copy rest of app
COPY backend/ ./

# ✅ Manually rebuild ONLY what you actually need
# (epoxy-transport builds fine without scramjet)
RUN pnpm rebuild @mercuryworkshop/epoxy-transport || true

# Remove dev deps
RUN pnpm prune --prod


# ---------- RUNTIME ----------
FROM node:22-alpine

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Copy built app
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend ./
COPY frontend/ /app/frontend/

EXPOSE 3001

CMD ["node", "src/server.js"]
