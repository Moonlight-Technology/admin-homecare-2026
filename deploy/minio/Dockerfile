# Community MinIO is source-only. Build our own images from explicit upstream releases.
# Refresh builder/runtime base images at deployment; pin their digests in your release registry.
FROM golang:1.26-bookworm AS minio-build
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
ENV CGO_ENABLED=0 GOBIN=/out GOTOOLCHAIN=local
RUN go install -trimpath github.com/minio/minio@${MINIO_VERSION}

FROM golang:1.26-bookworm AS mc-build
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
ENV CGO_ENABLED=0 GOBIN=/out GOTOOLCHAIN=local
RUN go install -trimpath github.com/minio/mc@${MC_VERSION}

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 minio \
    && useradd --uid 10001 --gid 10001 --no-create-home minio
ENV HOME=/tmp
USER 10001:10001

FROM runtime AS server
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.version=${MINIO_VERSION} \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=minio-build /out/minio /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--address", ":9000", "--console-address", ":9001"]

FROM runtime AS client
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.version=${MC_VERSION} \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=mc-build /out/mc /usr/local/bin/mc
ENTRYPOINT ["mc"]
