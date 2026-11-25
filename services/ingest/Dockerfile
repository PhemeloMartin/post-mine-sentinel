# syntax=docker/dockerfile:1.7
# ---- build: static, reproducible, stripped binary -------------------------------------------
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/ingest ./cmd/ingest

# ---- runtime: distroless, non-root, no shell -------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ingest /ingest
USER nonroot:nonroot
EXPOSE 9102
ENTRYPOINT ["/ingest"]
