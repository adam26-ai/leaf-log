import { describe, expect, it } from "vitest";
import { leafWebAppUrl } from "./leaf-web-app-url";

describe("leafWebAppUrl", () => {
  it.each([
    ["http://192.168.1.47/app", "http://192.168.1.47/app"],
    ["http://10.0.0.8:8080/", "http://10.0.0.8:8080/"],
    ["https://leaf-a1b2.local/app", "https://leaf-a1b2.local/app"],
    ["http://[fd12::47]/app", "http://[fd12::47]/app"],
    ["http://[fe80::47]/app", "http://[fe80::47]/app"],
  ])("accepts a local Leaf address %s", (value, normalized) => {
    expect(leafWebAppUrl(value)).toBe(normalized);
  });

  it("removes local query parameters and fragments", () => {
    expect(leafWebAppUrl("http://192.168.4.1/app?scan=1#leaf-log")).toBe(
      "http://192.168.4.1/app",
    );
  });

  it.each([
    undefined,
    "",
    "not a URL",
    "javascript:alert(1)",
    "https://leaflog.example/",
    "http://localhost/app",
    "http://user:password@192.168.1.47/app",
    "http://172.32.0.1/app",
  ])("rejects a non-Leaf return destination %s", value => {
    expect(leafWebAppUrl(value)).toBeNull();
  });
});
