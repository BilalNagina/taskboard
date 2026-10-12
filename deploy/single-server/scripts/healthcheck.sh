#!/usr/bin/env bash
# Waits (up to ~2 min) for the api, worker and web containers to be healthy and the API
# to reach PostgreSQL and Redis. Exits non-zero if they don't, so deploy.sh can roll back.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
cd "$APP_DIR"

status() {
  local id
  id="$(docker compose ps -q "$1")"
  [ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "missing"
}

api="unknown"
worker="unknown"
web="unknown"
for i in $(seq 1 40); do
  api="$(status api)"
  worker="$(status worker)"
  web="$(status web)"
  if [ "$api" = healthy ] && [ "$worker" = healthy ] && [ "$web" = healthy ] &&
    docker compose exec -T api wget -qO- http://127.0.0.1:3000/readyz >/dev/null 2>&1; then
    echo "healthy after $((i * 3))s"
    exit 0
  fi
  sleep 3
done

echo "not healthy: api=$api worker=$worker web=$web"
docker compose logs --tail=50 api worker
exit 1
