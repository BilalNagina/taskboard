#!/usr/bin/env bash
# Usage: deploy.sh <image-tag>
# Pulls the given image tag, restarts the stack and health-checks it.
# If the check fails, it rolls back to the previously deployed tag and exits non-zero.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
cd "$APP_DIR"

NEW_TAG="${1:?usage: deploy.sh <image-tag>}"
PREV_TAG="$(grep -E '^TAG=' .env | cut -d= -f2- || true)"

set_tag() {
  if grep -q '^TAG=' .env; then
    sed -i "s/^TAG=.*/TAG=$1/" .env
  else
    echo "TAG=$1" >> .env
  fi
}

echo "==> Deploying $NEW_TAG (currently ${PREV_TAG:-none})"
set_tag "$NEW_TAG"
docker compose pull api web worker
docker compose up -d --remove-orphans

# The proxy renders its config only when it starts, and new config files alone don't make
# compose recreate it, so restart it when they changed (a second's blip, only then).
NGINX_SUM="$(cat nginx/* | sha256sum | cut -d' ' -f1)"
if [ "$NGINX_SUM" != "$(cat .nginx.sum 2>/dev/null || true)" ]; then
  echo "==> nginx config changed, restarting the proxy"
  docker compose up -d --force-recreate proxy
  echo "$NGINX_SUM" > .nginx.sum
fi

if ./scripts/healthcheck.sh; then
  # Clean up images unused for a week; recent ones stay for quick rollbacks.
  docker image prune -af --filter "until=168h" >/dev/null
  echo "==> $NEW_TAG is live"
  exit 0
fi

echo "!! Health check failed for $NEW_TAG"
if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then
  echo "==> Rolling back to $PREV_TAG"
  set_tag "$PREV_TAG"
  docker compose up -d --remove-orphans
  ./scripts/healthcheck.sh && echo "==> Rolled back to $PREV_TAG"
fi
exit 1
