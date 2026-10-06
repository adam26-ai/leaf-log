import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NavigationBadge, NavigationNotifications } from "./navigation-notifications";

const mocks = vi.hoisted(() => ({ pathname: "/logbook", counts: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/app/notification-actions", () => ({ getNavigationCounts: mocks.counts }));
beforeEach(() => { mocks.pathname = "/logbook"; mocks.counts.mockReset(); });
const badges = (seen?: string, revision = "1") => <NavigationNotifications feedSeenThrough={seen} refreshKey={revision}>
  <NavigationBadge kind="feed" /><NavigationBadge kind="friends" />
</NavigationNotifications>;

it("shows accessible counts, caps large numbers, and hides zero counts", async () => {
  mocks.counts.mockResolvedValue({ feed: 123, friends: 1 });
  const view = render(badges());
  expect(await screen.findByRole("status", { name: "123 new flights" })).toHaveTextContent("99+");
  expect(screen.getByRole("status", { name: "1 pending friend request" })).toHaveTextContent("1");
  mocks.counts.mockResolvedValue({ feed: 0, friends: 0 });
  view.rerender(badges(undefined, "2"));
  await waitFor(() => expect(screen.queryAllByRole("status")).toHaveLength(0));
});

it("marks only a mounted Feed visit and refreshes on focus without marking unseen flights", async () => {
  mocks.counts.mockResolvedValue({ feed: 0, friends: 0 });
  const seen = "2026-10-05T12:00:00.000Z";
  const view = render(badges(seen));
  await waitFor(() => expect(mocks.counts).toHaveBeenLastCalledWith(undefined));
  mocks.pathname = "/feed";
  view.rerender(badges(seen));
  await waitFor(() => expect(mocks.counts).toHaveBeenLastCalledWith(seen));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(mocks.counts).toHaveBeenLastCalledWith(undefined);
});
