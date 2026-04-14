FROM docker.io/library/node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ gcc \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci

COPY . .

RUN cd frontend && npm run build
RUN npm run build

RUN npm prune --omit=dev && cd frontend && rm -rf node_modules

FROM docker.io/library/node:22-slim
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/package.json ./

RUN mkdir -p /app/data

EXPOSE 3100

ENV STORK_DATA_DIR=/app/data
ENV STORK_PORT=3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
