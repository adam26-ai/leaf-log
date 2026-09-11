// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { recordingDetails } from "./igc-details";

const original = new TextEncoder().encode("AXLF001 Borrowed recorder\nHFDTE120724\nHFPLTPILOTINCHARGE:Recorder Friend\nHFGTYGLIDERTYPE:Original Wing\n");
describe("original recording information", () => {
  it("keeps a saved correction separate from the unmodified file", () => {
    expect(recordingDetails({ pilot: "Earlier saved label", recorder: "cached recorder", data: { rawIgc: original } })).toEqual({
      originalAvailable: true, originalPilot: "Recorder Friend", originalGlider: "Original Wing", recorder: "XLF001 Borrowed recorder", savedPilotLabel: "Earlier saved label",
    });
  });
  it("does not turn a missing original name into a saved name or an unknown pilot", () => {
    expect(recordingDetails({ pilot: "Legacy label", recorder: null, data: { rawIgc: new TextEncoder().encode("AXLF001\nHFDTE120724\n") } })).toMatchObject({ originalPilot: null, savedPilotLabel: "Legacy label" });
  });
  it("does not present unchanged cached names as historical edits", () => {
    expect(recordingDetails({ pilot: "Recorder Friend", recorder: null, data: { rawIgc: original } }).savedPilotLabel).toBeNull();
    expect(recordingDetails({ pilot: null, recorder: null, data: { rawIgc: original } })).toMatchObject({ originalPilot: "Recorder Friend", savedPilotLabel: null });
  });
  it("preserves an intentionally cleared label without hiding the original name", () => {
    expect(recordingDetails({ pilot: "", recorder: null, data: { rawIgc: original } })).toMatchObject({ originalPilot: "Recorder Friend", savedPilotLabel: "" });
  });
  it("does not invent original metadata when a recording is missing", () => {
    expect(recordingDetails({ pilot: "Saved name", recorder: "Saved recorder", data: null })).toEqual({ originalAvailable: false, originalPilot: null, originalGlider: null, recorder: "Saved recorder", savedPilotLabel: "Saved name" });
  });
});
