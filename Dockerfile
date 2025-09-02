# Multi-stage build: frontend (Vite) + backend (FastAPI)

# ---------- Frontend build ----------
FROM node:20-alpine AS frontend
WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy sources and build
COPY index.html index.css index.tsx vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src

# Build static assets (no secrets baked by default)
RUN npm run build

# ---------- Backend runtime ----------
FROM python:3.11-slim AS backend
WORKDIR /app

# Keep the runtime lean; rely on manylinux wheels for deps

# Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY server.py ./
COPY src ./src

# Bring in built frontend assets
COPY --from=frontend /app/dist ./dist

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
