# Build from the repository root: docker compose -f deploy/compose.yaml build
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY companion/package.json companion/
COPY tv/package.json tv/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run check && npm test && npm run build -w companion && npm prune --omit=dev --ignore-scripts

FROM node:26-slim
ENV NODE_ENV=production SOFA_PORT=8090 SOFA_DB_PATH=/data/sofa.db SOFA_MEDIA_DIR=/media SOFA_COMPANION_DIR=/app/companion/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/companion/dist companion/dist
RUN mkdir -p /data /media && chown node:node /data /media
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:8090/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/src/main.ts"]
