import { tmpdir } from "node:os";
import { join } from "node:path";

/** Shared by the local email fallback and browser tests on every platform. */
export const DEV_MAGIC_LINK_FILE = join(tmpdir(), process.env.LEAF_E2E === "1" ? "leaf-e2e-magic-link.txt" : "leaf-magic-link.txt");
