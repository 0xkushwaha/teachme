# syntax=docker/dockerfile:1.7
FROM node:20.18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Only public, non-secret values may be baked into the client bundle.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
# Used by the /api rewrite fallback and server-side public fetches (not exposed to browsers).
ARG BACKEND_INTERNAL_URL=http://backend:4000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20.18-alpine AS runtime
RUN apk add --no-cache tini wget
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
