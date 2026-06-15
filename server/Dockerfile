# Publium backend — Express + Prisma + Playwright/Chromium.
# glibc base (bookworm) is required: sharp, @resvg/resvg-js and Chromium do not
# run reliably on alpine/musl.
FROM node:20-bookworm-slim

WORKDIR /app

# Full install incl. devDependencies (typescript, prisma) — needed to build and
# to run `prisma migrate deploy`. NODE_ENV is left unset here so npm installs dev
# deps; the runtime container gets NODE_ENV=production from docker-compose.
COPY package.json package-lock.json ./
RUN npm ci

# Prisma client + Chromium with its system libraries (for HTML cover rendering).
COPY prisma ./prisma
RUN npx prisma generate \
 && npx playwright install --with-deps chromium

# Build the TypeScript server.
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets
COPY scripts ./scripts
RUN npm run build

EXPOSE 8787

# Apply any pending DB migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
