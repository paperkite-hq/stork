FROM node:22-slim AS base
WORKDIR /app

# Install build tools required to compile better-sqlite3-multiple-ciphers native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ gcc \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Install frontend dependencies
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci

# Copy source
COPY . .

# Build frontend and backend
RUN cd frontend && npm run build
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3100

ENV STORK_DATA_DIR=/app/data
ENV STORK_PORT=3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
