import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceKeys, type DeviceTokenView } from "./device-keys";
import { deleteRevokedDeviceKeyAction, restoreDeviceKeyAction, revokeDeviceKeyAction } from "@/app/settings/devices/actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/settings/devices/actions", () => ({
  deleteRevokedDeviceKeyAction: vi.fn(),
  restoreDeviceKeyAction: vi.fn(),
  revokeDeviceKeyAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function token(overrides: Partial<DeviceTokenView> = {}): DeviceTokenView {
  return {
    id: "device-1",
    label: "Cockpit Leaf",
    deviceId: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    lastFlight: null,
    ...overrides,
  };
}

it("offers revoke for active devices", async () => {
  vi.mocked(revokeDeviceKeyAction).mockResolvedValue({ ok: true });
  render(<DeviceKeys tokens={[token()]} />);

  expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke Cockpit Leaf" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" })));

  expect(revokeDeviceKeyAction).toHaveBeenCalledWith("device-1");
  expect(refresh).toHaveBeenCalled();
});

it("lets the owner delete a revoked device after inline confirmation", async () => {
  vi.mocked(deleteRevokedDeviceKeyAction).mockResolvedValue({ ok: true });
  render(<DeviceKeys tokens={[token({ revokedAt: "2026-09-02T12:00:00.000Z" })]} />);

  expect(screen.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reinstate Cockpit Leaf" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete Cockpit Leaf" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm delete" })));

  expect(deleteRevokedDeviceKeyAction).toHaveBeenCalledWith("device-1");
  expect(refresh).toHaveBeenCalled();
});

it("reinstates a revoked device", async () => {
  vi.mocked(restoreDeviceKeyAction).mockResolvedValue({ ok: true });
  render(<DeviceKeys tokens={[token({ revokedAt: "2026-09-02T12:00:00.000Z" })]} />);

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reinstate Cockpit Leaf" })));

  expect(restoreDeviceKeyAction).toHaveBeenCalledWith("device-1");
  expect(refresh).toHaveBeenCalled();
});
