import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImportWizard } from "./import-wizard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => true }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const duplicateReview = {
  rows: [2, 3].map(line => ({
    line,
    errors: [],
    warnings: [],
    duplicates: [{ id: `existing-${line}`, label: `Existing flight ${line}` }],
  })),
};

it("accepts a dropped CSV and keeps other duplicate warnings after one row is skipped", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => duplicateReview }) as Response);
  vi.stubGlobal("fetch", fetch);
  render(<ImportWizard options={{ wings: [], sites: [], siteNames: [] }} />);

  const csv = "date,wing,site\n2024-01-01,Wing A,Hill\n2024-01-02,Wing B,Hill";
  const file = { name: "history.csv", size: csv.length, text: async () => csv } as File;
  fireEvent.drop(screen.getByText("Drop your completed CSV here").closest("label")!, {
    dataTransfer: { files: [file], types: ["Files"] },
  });

  expect(await screen.findByText("Match your columns")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue to names" }));
  fireEvent.click(screen.getByRole("button", { name: "Review flights" }));
  await waitFor(() => expect(screen.getAllByText("Possible duplicate of:")).toHaveLength(2));

  expect(screen.getAllByLabelText("This is a different flight; include it")).toHaveLength(2);
  expect(screen.getAllByLabelText("This is a duplicate; skip it")).toHaveLength(2);
  fireEvent.click(screen.getAllByLabelText("This is a duplicate; skip it")[0]);
  expect(screen.getAllByText("Possible duplicate of:")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Check preview" }));
  expect(await screen.findByText("You must finish marking these possible duplicate flights")).toBeInTheDocument();
  expect(screen.getAllByText("Possible duplicate of:")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Accept all" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Skip all" })).toBeInTheDocument();
});
