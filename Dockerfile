# Allow overriding the base image for environments where Docker Hub access is restricted.
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE} AS runtime

WORKDIR /app

RUN apk add --no-cache git python3 make g++

COPY backend/package.json ./package.json
RUN npm install --omit=dev

COPY backend/src ./src
COPY frontend/public ./frontend/public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
