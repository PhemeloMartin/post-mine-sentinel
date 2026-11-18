# syntax=docker/dockerfile:1.7
# Build context: repository root (the app bundles the canonical datasets from /data).
#   docker build -f apps/command-center/Dockerfile -t sentinel-console .
FROM node:20-alpine AS build
WORKDIR /repo/apps/command-center
COPY apps/command-center/package.json apps/command-center/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY data/ /repo/data/
COPY apps/command-center/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY apps/command-center/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/command-center/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/command-center/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
