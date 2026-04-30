FROM node:20-alpine AS deps
WORKDIR /app
COPY app-client/package.json app-client/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV SERVER_API_BASE=http://api-web.nasfaq.svc.cluster.local
ENV NEXT_PUBLIC_API_BASE=
COPY --from=deps /app/node_modules ./node_modules
COPY app-client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
