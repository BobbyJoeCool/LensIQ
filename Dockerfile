# LensIQ: one image that serves the React app and the API on port 3000.
# Voyager is amd64: build there with a plain `docker build`, or on Janeway with
#   docker buildx build --platform linux/amd64 -t lensiq:latest --load .

FROM node:22-alpine AS build
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY api api
COPY web web
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/package.json ./api/
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "api/dist/index.js"]
