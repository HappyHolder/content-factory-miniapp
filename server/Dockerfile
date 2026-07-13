# Publium backend — build TypeScript separately and run the API as an unprivileged user.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate \
 && npx playwright install --with-deps chromium

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node assets ./assets
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /data/uploads \
 && chown -R node:node /app /data/uploads /ms-playwright

USER node
EXPOSE 8787
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
