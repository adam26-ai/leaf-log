// Test helper: synthesize a valid IGC file from a list of fixes so we can assert
// derived metrics against known inputs.

export interface SynthFix {
  /** Seconds since midnight UTC. */
  tSec: number;
  lat: number;
  lon: number;
  baro?: number;
  gps?: number;
  valid?: boolean;
}

function pad(n: number, len: number): string {
  const s = Math.abs(Math.trunc(n)).toString().padStart(len, "0");
  return s.slice(-len);
}

function encodeLat(lat: number): string {
  const hemi = lat >= 0 ? "N" : "S";
  const a = Math.abs(lat);
  const deg = Math.floor(a);
  const minTimes1000 = Math.round((a - deg) * 60 * 1000);
  return pad(deg, 2) + pad(minTimes1000, 5) + hemi;
}

function encodeLon(lon: number): string {
  const hemi = lon >= 0 ? "E" : "W";
  const a = Math.abs(lon);
  const deg = Math.floor(a);
  const minTimes1000 = Math.round((a - deg) * 60 * 1000);
  return pad(deg, 3) + pad(minTimes1000, 5) + hemi;
}

function hhmmss(tSec: number): string {
  const t = ((tSec % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return pad(h, 2) + pad(m, 2) + pad(s, 2);
}

export function bRecord(f: SynthFix): string {
  const baro = pad(f.baro ?? 0, 5);
  const gps = pad(f.gps ?? f.baro ?? 0, 5);
  return `B${hhmmss(f.tSec)}${encodeLat(f.lat)}${encodeLon(f.lon)}${f.valid === false ? "V" : "A"}${baro}${gps}`;
}

export function makeIgc(opts: {
  date?: string; // DDMMYY
  pilot?: string;
  glider?: string;
  recorder?: string;
  fixes: SynthFix[];
}): string {
  const lines: string[] = [];
  lines.push(`A${opts.recorder ?? "XLF001 Leaf"}`);
  lines.push(`HFDTE${opts.date ?? "120724"}`);
  if (opts.pilot) lines.push(`HFPLTPILOTINCHARGE:${opts.pilot}`);
  if (opts.glider) lines.push(`HFGTYGLIDERTYPE:${opts.glider}`);
  for (const f of opts.fixes) lines.push(bRecord(f));
  return lines.join("\n") + "\n";
}

/**
 * Synthesize a realistic flight: a thermal climb at a known rate, then a glide
 * down. Returns the IGC text plus the ground-truth metrics for assertions.
 */
export function makeRealisticFlight() {
  const fixes: SynthFix[] = [];
  // Mussel Rock, CA — a real launch, but sites are fully community-driven
  // (no curated seed), so this resolves to "Unknown site" unless a test has
  // created a Site row here itself.
  const startLat = 37.6685;
  const startLon = -122.4936;
  let t = 36000; // 10:00:00 UTC
  let alt = 500;

  // 30s of pre-launch ground idle (no movement) — should be excluded.
  for (let i = 0; i < 30; i++) {
    fixes.push({ tSec: t, lat: startLat, lon: startLon, baro: alt, gps: alt + 5 });
    t += 1;
  }
  // 120s thermal climb: +3 m/s, circling (thermalling) while drifting east.
  const R = 0.0008; // circling radius in degrees (~70 m)
  let lat = startLat;
  let lon = startLon;
  for (let i = 0; i < 120; i++) {
    alt += 3;
    const cx = startLon + i * 0.00012; // thermal centre drifts east
    lat = startLat + R * Math.sin(i / 4);
    lon = cx + R * Math.cos(i / 4);
    fixes.push({ tSec: t, lat, lon, baro: alt, gps: alt + 5 });
    t += 1;
  }
  const peakAlt = alt; // 500 + 360 = 860
  // 120s glide: -2 m/s, gliding east in a straight line.
  for (let i = 0; i < 120; i++) {
    alt -= 2;
    lon += 0.00018;
    fixes.push({ tSec: t, lat, lon, baro: alt, gps: alt + 5 });
    t += 1;
  }
  // 20s post-landing idle — should be excluded.
  for (let i = 0; i < 20; i++) {
    fixes.push({ tSec: t, lat, lon, baro: alt, gps: alt + 5 });
    t += 1;
  }

  return {
    igc: makeIgc({ glider: "Test Wing", fixes }),
    truth: {
      peakAlt,
      climbRate: 3,
      sinkRate: -2,
      // flight window ≈ 240s of movement (climb + glide)
      approxDurationS: 240,
      startLat,
      startLon,
    },
  };
}
