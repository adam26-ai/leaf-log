# Device HTTP ingress proxy

The Leaf vario can't do TLS without stalling its background services, so it speaks
**plain HTTP**. Railway force-redirects HTTP→HTTPS at its edge (`http://…` → `301`),
so the Leaf can't reach the app directly. This is a tiny [Caddy](https://caddyserver.com)
reverse proxy that gives the device an **HTTP front door**:

```
Leaf  ──HTTP (plaintext)──►  this proxy  ──HTTPS──►  leaflog.norcalflight.com
        /api/ingest                                   (Railway app)
        /api/devices/pair/start
        /api/devices/pair/poll
```

Only those **three device endpoints** are exposed over HTTP. The website and the
session-authed pairing **claim** stay HTTPS-only on the main domain and are not
reachable through this proxy.

## Why a separate host

Railway (and most managed platforms) force HTTPS on their domains, and the app can't
override that — the redirect happens at the platform edge. So the plain-HTTP door has
to live somewhere that will actually serve HTTP on port 80: **a small VPS or any
Docker host**. Do **not** run this on Railway.

## Deploy

1. Put this `proxy/` directory on the host.
2. Point DNS at the host: an **A record** for `ingest.leaflog.norcalflight.com` → the
   host's public IP. (Or edit the site address in `Caddyfile` to your chosen host.)
3. Run it:
   ```bash
   docker compose up -d
   ```
4. Verify:
   ```bash
   curl -s http://ingest.leaflog.norcalflight.com/healthz          # -> ok
   curl -s -X POST http://ingest.leaflog.norcalflight.com/api/devices/pair/start   # -> pairing JSON
   ```

The Leaf is then configured to use `http://ingest.leaflog.norcalflight.com` as its
Leaf Log base URL for `pair/start`, `pair/poll`, and `ingest`.

## Security posture (HTTP is a deliberate tradeoff)

Because the Leaf hop is plaintext, the device token and every upload are sniffable on
the local network path. This is contained by design:

- **Device-pushed flights are forced PRIVATE** (`ingestFlight` overrides visibility for
  `source: "device_push"`), so a sniffed token can't publish public flights under the
  pilot's identity.
- The token is **upload-only, revocable, and rate-limited**; pairing codes are **short,
  single-use, short-TTL, and rate-limited**.
- The proxy exposes **only** the three device endpoints; the proxy→app leg is HTTPS.
- Impact of a stolen token is bounded to "inject private flights into my logbook until
  I revoke the device" — recoverable, not account takeover (the token can't read data
  or authenticate a session).

Future hardening (not in v1): per-IP/per-token rate limiting at the Caddy layer, and an
allowlist if the Leaf fleet uses known egress IPs.
