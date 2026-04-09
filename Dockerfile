# Stage 1: Build
FROM node:20-slim AS build

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/dashboard/package.json packages/dashboard/package.json

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy all source files
COPY . .

# Build CLI (TypeScript) + Dashboard (Vite)
RUN npm run build:web

# Stage 2: Runtime
FROM node:20-slim

WORKDIR /app

# Install system dependencies: Python 3, pip, Scrapy, ffmpeg, yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && python3 -m pip install --break-system-packages scrapy yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy built assets from build stage
COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/packages/dashboard/dist/ ./packages/dashboard/dist/
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

ENV HOST=0.0.0.0
ENV PORT=3000

ENTRYPOINT ["node", "dist/server/index.js"]
