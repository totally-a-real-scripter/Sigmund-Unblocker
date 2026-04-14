ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE}

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# System deps (minimal but safe for most node native builds)
RUN apk add --no-cache \
  git \
  bash \
  python3 \
  make \
  g++ \
  libc6-compat

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Copy backend first (better caching)
COPY backend/package.json ./
COPY backend/pnpm-lock.yaml* ./
COPY backend/.npmrc* ./

# Copy full backend source
COPY backend/ ./

# IMPORTANT FIX:
# - ignore scripts prevents wasm/cargo/git-based broken prepack hooks
# - install only production deps for runtime image
RUN pnpm install --prod --no-frozen-lockfile --ignore-scripts

EXPOSE 3001

CMD ["node", "src/server.js"]
