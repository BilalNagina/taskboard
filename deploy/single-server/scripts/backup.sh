#!/usr/bin/env bash
# Dumps PostgreSQL, compresses it, uploads it to S3 and keeps 7 days locally.
# S3 keeps 14 days (lifecycle rule in Terraform). Runs nightly from cron.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
load_env
: "${BACKUP_BUCKET:?BACKUP_BUCKET must be set in .env}"

mkdir -p "$BACKUP_DIR"
NAME="taskboard-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

# --clean --if-exists makes the dump restorable straight over an existing database.
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists |
  gzip > "$BACKUP_DIR/$NAME"
gzip -t "$BACKUP_DIR/$NAME"

aws_cli s3 cp "/backups/$NAME" "s3://$BACKUP_BUCKET/postgres/$NAME" --only-show-errors
find "$BACKUP_DIR" -name 'taskboard-*.sql.gz' -mtime +7 -delete

echo "$(date -u +%FT%TZ) backup ok: $NAME ($(du -h "$BACKUP_DIR/$NAME" | cut -f1))"
