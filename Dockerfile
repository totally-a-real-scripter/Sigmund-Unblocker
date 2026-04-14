FROM node:22-alpine AS runtime

WORKDIR /app

# Install production dependencies for the Node orchestrator
COPY backend/package.json ./package.json
RUN npm install --omit=dev

# Copy backend source + static frontend bundle
COPY backend/src ./src
COPY frontend/public ./frontend/public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
