import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const examples = [
  "2026-06-11-XNA-012A0E13E4CAE10B9F78BA46365F9A14-03 (1).igc",
  "2026-06-12-XNA-012A0E13E4CAE10B9F78BA46365F9A14-01 (3).igc",
];

/** Test copies share June 11, preserving launch times, fixes, and original files.
 * Original signatures are removed because the copied headers are intentionally edited.
 */
export function groupReplayFixtures() {
  return examples.map((name, index) => {
    const raw = readFileSync(resolve(process.cwd(), "test/igc/example-IGC-files", name), "utf8");
    return Buffer.from(raw.replace(/\r\n/g, "\n").split("\n")
      .filter((line) => !line.startsWith("G"))
      .map((line) => line.replace(/^(HFDTE(?:DATE:)?)(\d{6})/, "$1110626")
        .replace(/^(C)\d{6}(?=\d{6})/, "$1110626")
        .replace(/^HFPLTPILOTINCHARGE:.*/, `HFPLTPILOTINCHARGE:${index ? "Friend" : "Self"} (replay demo)`))
      .join("\r\n"));
  });
}
