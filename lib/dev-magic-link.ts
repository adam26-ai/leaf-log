import { tmpdir } from "node:os";
import { join } from "node:path";

/** Shared by the local email fallback and browser tests on every platform. */
export const DEV_MAGIC_LINK_FILE = join(tmpdir(), "leaf-magic-link.txt");
