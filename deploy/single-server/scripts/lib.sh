# Shared helpers, sourced by the other scripts.
# shellcheck shell=bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR=/var/backups/taskboard

load_env() {
  cd "$APP_DIR" || return
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

# Runs the AWS CLI in a container, so the server doesn't need it installed.
aws_cli() {
  docker run --rm \
    -e AWS_ACCESS_KEY_ID="$BACKUP_AWS_ACCESS_KEY_ID" \
    -e AWS_SECRET_ACCESS_KEY="$BACKUP_AWS_SECRET_ACCESS_KEY" \
    -e AWS_DEFAULT_REGION="$BACKUP_AWS_REGION" \
    -v "$BACKUP_DIR:/backups" \
    amazon/aws-cli:latest "$@"
}
