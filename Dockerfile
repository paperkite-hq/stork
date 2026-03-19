FROM oven/bun:1.2 AS base
WORKDIR /app

# Install build tools required to compile @signalapp/better-sqlite3 native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ gcc \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies (compiles native modules against Node.js headers)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Install frontend dependencies
COPY frontend/package.json frontend/bun.lock* frontend/
RUN cd frontend && (bun install --frozen-lockfile 2>/dev/null || bun install)

# Copy source
COPY . .

# Build frontend and backend
RUN cd frontend && bun run build
RUN bun run build

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3100

ENV STORK_DATA_DIR=/app/data
ENV STORK_PORT=3100

# Run with Node.js — @signalapp/better-sqlite3 requires Node.js (not Bun)
CMD ["node", "dist/index.js"]
