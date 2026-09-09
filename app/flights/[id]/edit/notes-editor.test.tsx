import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotesEditor } from "./notes-editor";
import { updateNotes, type NotesState } from "./actions";

vi.mock("./actions", () => ({ updateNotes: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

function setup() {
  vi.useFakeTimers();
  render(<NotesEditor flightId="flight-1" notes="Original notes" />);
  return screen.getByRole("textbox", { name: "Flight notes" });
}

it("saves after a pause and serializes newer edits behind an outstanding save", async () => {
  let finish!: (value: NotesState) => void;
  vi.mocked(updateNotes).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true });
  const input = setup();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(updateNotes).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "First" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  fireEvent.change(input, { target: { value: "Second" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(699); });
  expect(updateNotes).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(vi.mocked(updateNotes).mock.calls[0][2].get("notes")).toBe("Second");
  fireEvent.change(input, { target: { value: "Latest" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(updateNotes).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ ok: true }); });
  expect(screen.queryByText("Changes saved")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(vi.mocked(updateNotes).mock.calls[1][2].get("notes")).toBe("Latest");
  expect(screen.getByText("Changes saved")).toBeTruthy();
});

it("saves an empty note on blur without waiting for the typing delay", async () => {
  vi.mocked(updateNotes).mockResolvedValue({ ok: true });
  const input = setup();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(vi.mocked(updateNotes).mock.calls[0][2].get("notes")).toBe("");
  expect(screen.getByText("Changes saved")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it.each(["server", "network"])("shows a %s failure and retries the retained notes", async (failure) => {
  if (failure === "server") vi.mocked(updateNotes).mockResolvedValueOnce({ error: "Not signed in." });
  else vi.mocked(updateNotes).mockRejectedValueOnce(new Error("offline"));
  vi.mocked(updateNotes).mockResolvedValue({ ok: true });
  const input = setup();
  fireEvent.change(input, { target: { value: "Keep these notes" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(screen.queryByText("Changes saved")).toBeNull();
  expect((input as HTMLTextAreaElement).value).toBe("Keep these notes");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(updateNotes).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Changes saved")).toBeTruthy();
});
