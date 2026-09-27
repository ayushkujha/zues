# PanchayatCast: API + dashboard in one image.
#   docker compose up --build            (API + UI on http://localhost:8000, PostgreSQL)
#   docker compose run --rm api pcast demo   (build the synthetic demo region + models)

# ---- 1. Build the dashboard ------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2. Python runtime --------------------------------------------------------
FROM python:3.12-slim
# libgomp1: OpenMP runtime needed by LightGBM
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PCAST_ROOT=/app PYTHONUNBUFFERED=1
COPY pyproject.toml README.md ./
COPY src/ src/
RUN pip install --no-cache-dir ".[postgres]"
COPY configs/ configs/
COPY --from=web /web/dist web/dist
VOLUME ["/app/data", "/app/models", "/app/reports"]
EXPOSE 8000
CMD ["pcast", "serve", "--host", "0.0.0.0", "--port", "8000"]
