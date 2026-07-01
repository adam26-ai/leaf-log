# Device HTTP ingress proxy — bakes the Caddyfile into the official Caddy image.
# Railway builds this when the service's root directory is set to `proxy/`.
FROM caddy:2
COPY Caddyfile /etc/caddy/Caddyfile
# Caddy listens on $PORT (Railway injects it); the TCP proxy forwards to it.
