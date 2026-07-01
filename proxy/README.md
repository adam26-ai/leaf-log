# Device HTTP ingress proxy

The Leaf vario can't do TLS without stalling its background services, so it speaks
**plain HTTP**. Railway force-redirects HTTP→HTTPS on its normal web domains
(`http://…` → `301`), so the Leaf can't reach the app directly. This is a tiny
[Caddy](https://caddyserver.com) reverse proxy that gives the device an **HTTP front
door**:

```
Leaf  ──HTTP (plaintext)──►  this proxy  ──HTTPS──►  leaflog.norcalflight.com
        /api/ingest                                   (Railway app)
        /api/devices/pair/start
        /api/devices/pair/poll
```

Only those **three device endpoints** are exposed over HTTP. The website and the
session-authed pairing **claim** stay HTTPS-only on the main domain and are not
reachable through this proxy. Caddy listens on `$PORT` (default `:80`) on **any Host**.

## Why a separate front door

Railway won't serve plain HTTP on its web domains, and the app can't override that —
the HTTPS redirect happens at Railway's edge. So the plain-HTTP door has to be its own
thing. You have two ways to host it:

### Option A — Railway service + TCP Proxy (recommended, stays on Railway)

Railway's **TCP Proxy** is raw-TCP passthrough (the same feature your Postgres public
URL uses) — no TLS, no redirect. Run this proxy as a Railway service behind a TCP proxy
and the Leaf gets a plain-HTTP door at `…proxy.rlwy.net:<port>`.

1. **New service, same repo:** create a service in the `leaf-log` Railway project, set
   its **root directory to `proxy/`** (it builds the `Dockerfile`).
2. **Attach a TCP Proxy** to the service (Settings → Networking → TCP Proxy). Railway
   gives you `xxxx.proxy.rlwy.net:<external-port>` and injects `PORT` — Caddy listens on
   it automatically.
3. **(Optional) private-network upstream:** by default Caddy forwards to
   `https://leaflog.norcalflight.com` (Caddy does the TLS the Leaf can't). To keep the
   hop on Railway's private network instead, set on the proxy service:
   `UPSTREAM=http://web.railway.internal:<web-app-port>` and
   `UPSTREAM_HOST=leaflog.norcalflight.com`.
4. **Point the Leaf** at `http://xxxx.proxy.rlwy.net:<external-port>` for `pair/start`,
   `pair/poll`, and `ingest`. (The host+port are Railway-generated; a CNAME can't carry
   a port, so bake the full `host:port` into the firmware config.)
5. Verify:
   ```bash
   curl -s http://xxxx.proxy.rlwy.net:<port>/healthz                       # -> ok
   curl -s -X POST http://xxxx.proxy.rlwy.net:<port>/api/devices/pair/start # -> pairing JSON
   ```

### Option B — any plain-HTTP host (VPS / Docker) with a custom hostname

If you want a pretty `http://ingest.leaflog.norcalflight.com` on port 80, run it on a
host that serves plain HTTP:

1. Put this `proxy/` dir on the host; `docker compose up -d`.
2. DNS: **A record** `ingest.leaflog.norcalflight.com` → the host's public IP.
3. Point the Leaf at `http://ingest.leaflog.norcalflight.com`.

(Do **not** run this on Railway's normal web domain — it forces HTTPS. Only the TCP
Proxy in Option A serves plain HTTP on Railway.)

## Security posture (HTTP is a deliberate tradeoff)

Because the Leaf hop is plaintext, the device token and every upload are sniffable on
the local network path. This is contained by design:

- **Device-pushed flights are forced PRIVATE** (`ingestFlight` overrides visibility for
  `source: "device_push"`), so a sniffed token can't publish public flights under the
  pilot's identity.
- The token is **upload-only, revocable, and rate-limited**; pairing codes are **short,
  single-use, short-TTL, and rate-limited**.
- The proxy exposes **only** the three device endpoints; the proxy→app leg is HTTPS
  (Option A default) or Railway's private network (Option A alt).
- Impact of a stolen token is bounded to "inject private flights into my logbook until I
  revoke the device" — recoverable, not account takeover (the token can't read data or
  authenticate a session).

Future hardening (not in v1): per-IP/per-token rate limiting at the Caddy layer, and an
allowlist if the Leaf fleet uses known egress IPs.
