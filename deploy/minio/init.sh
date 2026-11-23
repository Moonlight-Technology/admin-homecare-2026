#!/bin/sh
set -eu

: "${MINIO_ENDPOINT:?Missing MINIO_ENDPOINT}"
: "${MINIO_ROOT_USER:?Missing MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?Missing MINIO_ROOT_PASSWORD}"
: "${MINIO_APP_USER:?Missing MINIO_APP_USER}"
: "${MINIO_APP_PASSWORD:?Missing MINIO_APP_PASSWORD}"
: "${MINIO_BUCKET:?Missing MINIO_BUCKET}"

# Validate names before substituting into JSON. This deployment deliberately uses one DNS-safe bucket.
case "$MINIO_BUCKET" in *[!a-z0-9-]*|'') echo 'MINIO_BUCKET must contain lowercase letters, digits and hyphens only.' >&2; exit 1;; esac
if [ "${#MINIO_BUCKET}" -lt 3 ] || [ "${#MINIO_BUCKET}" -gt 63 ]; then echo 'MINIO_BUCKET must be 3-63 characters.' >&2; exit 1; fi
case "$MINIO_ROOT_PASSWORD:$MINIO_APP_PASSWORD" in *replace-*|*changeme*|*minioadmin*) echo 'Replace the example passwords before setup.' >&2; exit 1;; esac
if [ "${#MINIO_ROOT_PASSWORD}" -lt 32 ] || [ "${#MINIO_APP_PASSWORD}" -lt 32 ]; then echo 'Use random passwords of at least 32 characters.' >&2; exit 1; fi
if [ "$MINIO_APP_USER" = "$MINIO_ROOT_USER" ] || [ "$MINIO_APP_PASSWORD" = "$MINIO_ROOT_PASSWORD" ]; then echo 'Root and application credentials must be different.' >&2; exit 1; fi

mc alias set storage "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc ready storage >/dev/null
mc mb --ignore-existing "storage/$MINIO_BUCKET"
mc anonymous set none "storage/$MINIO_BUCKET"
mc version enable "storage/$MINIO_BUCKET"
sed "s/__BUCKET__/$MINIO_BUCKET/g" /scripts/app-policy.json > /tmp/app-policy.json
mc admin policy create storage nakes-documents-api /tmp/app-policy.json

# Re-running setup must not silently rotate the password of an existing application user.
if mc admin user info storage "$MINIO_APP_USER" >/dev/null 2>&1; then
  echo 'Application user already exists; retaining its password.'
else
  mc admin user add storage "$MINIO_APP_USER" "$MINIO_APP_PASSWORD"
fi
mc admin policy attach storage nakes-documents-api --user "$MINIO_APP_USER"
mc alias set app "$MINIO_ENDPOINT" "$MINIO_APP_USER" "$MINIO_APP_PASSWORD" >/dev/null
mc stat "app/$MINIO_BUCKET" >/dev/null
echo 'MinIO ready: private versioned bucket and scoped application credentials verified.'
