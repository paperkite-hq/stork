FROM node:22-slim AS base
WORKDIR /app

# Install build tools required to compile @signalapp/better-sqlite3 native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ gcc \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

# Install frontend dependencies
COPY frontend/package.json frontend/package-lock.json* frontend/
RUN cd frontend && (npm ci 2>/dev/null || npm install)

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

CMD ["node", "dist/index.js"]
