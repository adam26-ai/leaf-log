import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { claimDeviceAction } from "@/app/settings/devices/actions";
import { ActivateConfirm } from "./activate-confirm";

vi.mock("@/app/settings/devices/actions", () => ({
  claimDeviceAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function connect(returnTo: string | null) {
  vi.mocked(claimDeviceAction).mockResolvedValue({ ok: true });
  render(
    <ActivateConfirm
      code="ABC234"
      displayName="Ada"
      returnTo={returnTo}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connect this Leaf" }));
  });
  await waitFor(() => {
    expect(screen.getByText("Your Leaf is linked")).toBeInTheDocument();
  });
}

it("offers the validated Leaf Web App return destination after linking", async () => {
  await connect("http://192.168.1.47/app");

  expect(
    screen.getByRole("link", { name: "Return to Leaf Web App" }),
  ).toHaveAttribute("href", "http://192.168.1.47/app");
  expect(
    screen.getByText(/You can now return to the Leaf Web App/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("You can now close this tab."),
  ).not.toBeInTheDocument();
});

it("does not offer a return button without a tracked Leaf Web App", async () => {
  await connect(null);

  expect(
    screen.queryByRole("link", { name: "Return to Leaf Web App" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("You can now close this tab.")).toBeInTheDocument();
  expect(screen.getByText(/Devices/)).toBeInTheDocument();
});
