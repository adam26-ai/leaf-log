import { writeFileSync } from "node:fs";
import { makeRealisticFlight } from "@/test/igc/make-igc";

const out = process.argv[2] ?? "/tmp/realistic.igc";
writeFileSync(out, makeRealisticFlight().igc);
console.log("wrote", out);
