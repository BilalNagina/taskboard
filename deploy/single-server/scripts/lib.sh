# Shared helpers, sourced by the other scripts.
# shellcheck shell=bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR=/var/backups/taskboard

# Reads .env the way Docker Compose does: KEY=value per line, with optional surrounding
# quotes, and # comments. It isn't run as shell code, so a value like
# MAIL_FROM=Tasklane <reminders@example.com> can't break the scripts (sourcing it made
# bash read < and > as redirections, and the nightly backup stopped).
load_env() {
  cd "$APP_DIR" || return
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    export "$key=$value"
  done < .env
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
