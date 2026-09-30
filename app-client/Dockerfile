FROM node:20-alpine AS deps
WORKDIR /app
COPY app-client/package.json app-client/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
# Art loads from the CDN (app-client/public/art is not in the repo); see DEPLOYMENT.md 2.6.1.
ARG NEXT_PUBLIC_ART_BASE_URL="https://images.nasfaq.biz/art"
# The release (sha-<commit>), set by the deploy workflow. Next.js uses it to reload a page whose
# code is from an older release on its next navigation; pages compare it with /api/site to offer a
# refresh. Empty in local builds, which turns both off.
ARG APP_VERSION=""
ENV NEXT_DEPLOYMENT_ID=$APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
ENV SERVER_API_BASE=http://api-web.nasfaq.svc.cluster.local
ENV NEXT_PUBLIC_API_BASE=
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_ART_BASE_URL=$NEXT_PUBLIC_ART_BASE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY app-client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ARG APP_VERSION=""
ENV NEXT_DEPLOYMENT_ID=$APP_VERSION
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
