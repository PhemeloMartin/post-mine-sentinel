# syntax=docker/dockerfile:1.7
# Build context: repository root (the API depends on ml/ and data/).
#   docker build -f services/api/Dockerfile -t sentinel-api .
FROM python:3.12-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
COPY ml/ ml/
COPY services/api/ services/api/
RUN python -m venv /venv && /venv/bin/pip install ./ml ./services/api

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/venv/bin:$PATH \
    SENTINEL_DATA_DIR=/app/data
RUN groupadd --system --gid 10001 sentinel && useradd --system --uid 10001 --gid sentinel --no-create-home sentinel
WORKDIR /app/services/api
COPY --from=build /venv /venv
COPY --chown=sentinel:sentinel services/api/ /app/services/api/
COPY --chown=sentinel:sentinel data/ /app/data/
COPY --chown=sentinel:sentinel ml/artifacts/ /app/ml/artifacts/
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health',timeout=2).status==200 else 1)"
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
