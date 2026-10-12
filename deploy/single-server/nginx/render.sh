#!/bin/sh
# Renders the nginx config at container start. HTTPS is switched on only once a
# certificate exists, so the very first start can serve the Let's Encrypt challenge.
set -eu
: "${DOMAIN:?DOMAIN must be set}"

TEMPLATES=/etc/nginx/taskboard
rm -f /etc/nginx/conf.d/*.conf
envsubst '${DOMAIN}' < "$TEMPLATES/http.conf.template" > /etc/nginx/conf.d/http.conf

if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  envsubst '${DOMAIN}' < "$TEMPLATES/https.conf.template" > /etc/nginx/conf.d/https.conf
  echo "render.sh: certificate found, HTTPS enabled for $DOMAIN"
else
  echo "render.sh: no certificate for $DOMAIN yet, serving the ACME challenge only"
fi

exec nginx -g 'daemon off;'
