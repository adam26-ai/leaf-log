import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminManager } from "./admin-manager";
import { changeSiteAdminAction, searchAdminUsersAction } from "./actions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ changeSiteAdminAction: vi.fn(), searchAdminUsersAction: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const mainAdmin = { id: "main", handle: "main", displayName: "Main" };
const admin = { id: "admin", handle: "pilot", displayName: "Pilot", email: "pilot@test.local", revoked: false };

it("requires a separate revoke confirmation and exposes deletion only for revoked entries", async () => {
  vi.mocked(changeSiteAdminAction).mockResolvedValue({ ok: true });
  const view = render(<AdminManager mainAdmin={mainAdmin} admins={[admin]} />);
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(changeSiteAdminAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
  await waitFor(() => expect(changeSiteAdminAction).toHaveBeenCalledWith("admin", "revoke"));
  await screen.findByRole("status");
  view.rerender(<AdminManager mainAdmin={mainAdmin} admins={[{ ...admin, revoked: true }]} />);
  expect(screen.getByRole("button", { name: "Re-enable" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(changeSiteAdminAction).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(changeSiteAdminAction).toHaveBeenCalledWith("admin", "delete"));
});

it("lets the main admin select a search result and shows a rejected grant", async () => {
  vi.mocked(searchAdminUsersAction).mockResolvedValue({ ok: true, users: [{ id: "pilot", email: "pilot@test.local", profile: { handle: "pilot", displayName: "Pilot" } }] });
  vi.mocked(changeSiteAdminAction).mockResolvedValue({ ok: false, error: "Access denied" });
  render(<AdminManager mainAdmin={mainAdmin} admins={[]} />);
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pilot" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await within(screen.getByRole("list", { name: "User search results" })).findByRole("button"));
  fireEvent.click(screen.getByRole("button", { name: "Grant site admin access" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(changeSiteAdminAction).toHaveBeenCalledWith("pilot", "grant");
});
