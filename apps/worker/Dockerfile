FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests and root tsconfig
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/queue/package.json ./packages/queue/
COPY packages/evolution/package.json ./packages/evolution/
COPY packages/llm/package.json ./packages/llm/
COPY apps/worker/package.json ./apps/worker/

# Install all workspace deps
RUN npm ci

# Copy source
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/

# Build packages then app
RUN npm run build -w packages/db
RUN npm run build -w packages/queue
RUN npm run build -w packages/evolution
RUN npm run build -w packages/llm
RUN npm run build -w apps/worker

# ----

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/queue/package.json ./packages/queue/
COPY packages/evolution/package.json ./packages/evolution/
COPY packages/llm/package.json ./packages/llm/
COPY apps/worker/package.json ./apps/worker/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/queue/dist ./packages/queue/dist
COPY --from=builder /app/packages/evolution/dist ./packages/evolution/dist
COPY --from=builder /app/packages/llm/dist ./packages/llm/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

CMD ["node", "apps/worker/dist/index.js"]
