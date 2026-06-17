import { test, expect } from "bun:test";
import { formatBytes } from "./format";

test("formatBytes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(2048)).toBe("2 KB");
  expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
});
