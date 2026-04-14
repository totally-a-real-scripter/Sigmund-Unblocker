# ---------- BUILD STAGE ----------
FROM node:22-alpine AS builder

WORKDIR /app/backend

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# System deps for native builds
RUN apk add --no-cache \
  git \
  bash \
  python3 \
  make \
  g++ \
  libc6-compat

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Copy only dependency files first (better caching)
COPY backend/package.json ./
COPY backend/pnpm-lock.yaml* ./
COPY backend/.npmrc* ./

# Install ALL deps (scripts ENABLED here)
RUN pnpm install --no-frozen-lockfile

# Copy full source
COPY backend/ ./

# ---------- RUNTIME STAGE ----------
FROM node:22-alpine

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Enable pnpm (optional but consistent)
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Copy built app + node_modules from builder
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend ./

# Optional: prune devDependencies (extra clean)
RUN pnpm prune --prod

EXPOSE 3001

CMD ["node", "src/server.js"]
