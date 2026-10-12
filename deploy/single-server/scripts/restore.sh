#!/usr/bin/env bash
# Usage: restore.sh <backup-name|latest> [--yes]
# Restores a backup from S3 over the live database. The API is stopped while it runs.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
load_env

NAME="${1:?usage: restore.sh <backup-name|latest> [--yes]}"
mkdir -p "$BACKUP_DIR"

if [ "$NAME" = latest ]; then
  NAME="$(aws_cli s3 ls "s3://$BACKUP_BUCKET/postgres/" | awk '{print $4}' | sort | tail -n 1)"
  [ -n "$NAME" ] || { echo "no backups found in s3://$BACKUP_BUCKET/postgres/"; exit 1; }
fi

if [ "${2:-}" != "--yes" ]; then
  read -r -p "Restore $NAME over the live database? Type 'restore' to continue: " answer
  [ "$answer" = restore ] || { echo "aborted"; exit 1; }
fi

echo "==> Downloading $NAME"
aws_cli s3 cp "s3://$BACKUP_BUCKET/postgres/$NAME" "/backups/$NAME" --only-show-errors
gzip -t "$BACKUP_DIR/$NAME"

echo "==> Restoring (API stopped)"
docker compose stop api
gunzip -c "$BACKUP_DIR/$NAME" |
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose start api
./scripts/healthcheck.sh
echo "==> Restored $NAME"
