ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE} AS deps

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=development

# Install build tools + bash (required by some postinstall scripts)
RUN apk add --no-cache \
  git \
  bash \
  python3 \
  make \
  g++ \
  libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@10.13.1 --activate

# Copy backend first
COPY backend ./backend

# Install ALL dependencies (NOT production-only) so build scripts succeed
RUN set -eux; \
  cp backend/package.json ./package.json; \
  if [ -f backend/pnpm-lock.yaml ]; then cp backend/pnpm-lock.yaml ./pnpm-lock.yaml; fi; \
  if [ -f backend/.npmrc ]; then cp backend/.npmrc ./.npmrc; fi; \
  \
  pnpm install --frozen-lockfile || pnpm install

# Build step (if your project has one)
RUN if [ -f package.json ] && grep -q "\"build\"" package.json; then \
      pnpm run build; \
    fi

# Now prune to production deps only
RUN pnpm prune --prod


FROM ${NODE_BASE_IMAGE} AS runtime

WORKDIR /app

ENV NODE_ENV=production

# runtime still needs bash if any scripts rely on it
RUN apk add --no-cache bash

COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src
COPY frontend/public ./frontend/public

EXPOSE 3000

CMD ["node", "src/server.js"]
