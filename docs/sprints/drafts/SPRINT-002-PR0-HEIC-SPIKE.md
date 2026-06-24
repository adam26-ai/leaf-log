# SPRINT-002 · PR-0 — HEIC decode spike (findings)

**Question:** can we decode HEIC (iPhone default) reliably on the Railway image, and how?

## Findings

- `sharp` (libvips 8.18.3) **has HEIF input compiled in** (`sharp.format.heif.input === true`),
  so on the surface it looks like sharp can read HEIC.
- **But sharp fails on real iPhone-structured HEIC.** iPhones encode HEIC as a **tiled grid**
  (≈512 px tiles → dozens of `iref` references). sharp's bundled libheif enforces a default
  **16-reference security limit** and throws:

  > `heif: Invalid input: Number of references in iref box (N) exceeds the security limits of 16 references.`

  Reproduced with a 4080×3072 photo (48 refs) and a downscaled 2400 px fixture (20 refs). sharp
  exposes **no API** to raise this limit. So sharp alone cannot decode typical iPhone HEICs.
- **`heic-convert` decodes them fine.** It bundles libheif as **WASM (pure JS)**, has no native
  dependency, and handled both fixtures (4080×3072 in ~670 ms). Output is a JPEG/PNG buffer that
  `sharp` then rotates/resizes/strips normally.

## Decision

**HEIC/HEIF → `heic-convert` → JPEG buffer → `sharp` (rotate/resize/strip/encode); JPEG/PNG →
`sharp` directly.** Encapsulated in `lib/photos/decode.ts` (`decodeToSharp`, `isHeic`).

Why this de-risks Railway: `heic-convert` is WASM, so it behaves identically across macOS/dev and
the Linux Railway image — **no libheif/system package to provision**, and we don't depend on
sharp's HEIF support at all for HEIC. (EXIF is still read from the original HEIC bytes via
`exifr` in PR-1; only the *pixels* go through `heic-convert`.)

Trade-offs: `heic-convert` is slower than native and decodes to full-res first (memory) — fine
for the upload path given sequential processing + size/count caps (SPRINT-002).

## Deliverables in this PR

- `heic-convert` dependency.
- `lib/photos/decode.ts` + `lib/photos/decode.test.ts` (the verified decode seam).
- `test/photos/fixtures/tiled-sample.heic` — a 710 KB tiled HEIC that reproduces the sharp
  failure (`scripts/verify-heic.ts`) without needing macOS/`sips`.

## Caveats / remaining checks

- **libheif-wasm does not run under the vitest harness** (throws a `BindingError`), so the HEIC
  *pixel* decode is proven via `scripts/verify-heic.ts` in the real Node runtime (`node --import
  tsx scripts/verify-heic.ts` → decodes to 2048×1542). Vitest covers the routing (`isHeic` +
  JPEG/PNG passthrough).
- **PR-2 must confirm Next.js bundles the WASM** when `decode.ts` is imported by a route handler
  (`pnpm build` + an upload smoke). WASM-in-Next can need config; verify before relying on it.
- EXIF for HEIC is read from the original bytes via `exifr` (PR-1), not from the converted JPEG.
