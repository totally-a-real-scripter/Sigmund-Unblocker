# Allow overriding the base image for environments where Docker Hub access is restricted.
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE} AS deps

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN apk add --no-cache git python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@10.13.1 --activate

# Copy backend manifest directory so pnpm-lock.yaml/.npmrc are used automatically when present.
COPY backend ./backend

RUN set -eux; \
  cp backend/package.json ./package.json; \
  if [ -f backend/pnpm-lock.yaml ]; then cp backend/pnpm-lock.yaml ./pnpm-lock.yaml; fi; \
  if [ -f backend/.npmrc ]; then cp backend/.npmrc ./.npmrc; fi; \
  if [ -f pnpm-lock.yaml ]; then \
    pnpm install --prod --frozen-lockfile || \
    (echo 'Frozen lockfile install failed; retrying with --no-frozen-lockfile' && pnpm install --prod --no-frozen-lockfile); \
  else \
    echo 'pnpm-lock.yaml not found; using non-frozen install'; \
    pnpm install --prod --no-frozen-lockfile; \
  fi

FROM ${NODE_BASE_IMAGE} AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache git python3 make g++

COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src
COPY frontend/public ./frontend/public

EXPOSE 3000
CMD ["node", "src/server.js"]
