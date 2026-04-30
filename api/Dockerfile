FROM node:20-alpine AS deps
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY api/ ./
COPY ytscraper/internal/db/schema.sql /app/schema/ytscraper-schema.sql
ENV YT_SCHEMA_PATH=/app/schema/ytscraper-schema.sql
EXPOSE 5067
USER node
CMD ["node", "src/server.js"]
