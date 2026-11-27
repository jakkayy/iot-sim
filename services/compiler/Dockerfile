# Compile service image. Build from the repository root:
#   docker build -f services/compiler/Dockerfile -t esp32-sim-compiler:dev .
FROM golang:1.26 AS build
WORKDIR /src
COPY services/compiler/go.mod ./
COPY services/compiler/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /compiler .

FROM alpine:3.21
# docker-cli talks to the Docker API through docker-socket-proxy (DOCKER_HOST=tcp://...).
RUN apk add --no-cache docker-cli ca-certificates && adduser -D -u 10001 app && mkdir /cache && chown app /cache
COPY --from=build /compiler /usr/local/bin/compiler
USER app
ENV CACHE_DIR=/cache ADDR=:8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/compiler"]
