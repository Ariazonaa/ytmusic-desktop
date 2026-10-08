import { describe, expect, it, vi } from "vitest";
import { describeLogArguments, fileLogger } from "./log";

describe("describeLogArguments", () => {
  it("joins texts, values and errors into one line", () => {
    const line = describeLogArguments(["[ytm-desktop] failed", { plugin: "lyrics" }, 3, new TypeError("boom")]);
    expect(line).toContain('[ytm-desktop] failed {"plugin":"lyrics"} 3 TypeError: boom');
    expect(line).not.toContain("\n");
  });

  it("copes with values that cannot be turned into JSON", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(describeLogArguments([loop, undefined])).toBe("[object Object] undefined");
  });
});

describe("fileLogger", () => {
  it("logs errors to the console and the file, warnings to the console only", () => {
    const target = { warn: vi.fn(), error: vi.fn() };
    const write = vi.fn(() => Promise.resolve());
    const log = fileLogger(write, target);

    log.warn("careful");
    log.error("broken", 1);

    expect(target.warn).toHaveBeenCalledWith("careful");
    expect(target.error).toHaveBeenCalledWith("broken", 1);
    expect(write).toHaveBeenCalledExactlyOnceWith("broken 1");
  });

  it("survives a file that cannot be written", async () => {
    const target = { warn: vi.fn(), error: vi.fn() };
    const rejecting = fileLogger(() => Promise.reject(new Error("no backend")), target);
    const throwing = fileLogger(() => {
      throw new Error("no backend");
    }, target);
    expect(() => rejecting.error("a")).not.toThrow();
    expect(() => throwing.error("b")).not.toThrow();
    await Promise.resolve();
    expect(target.error).toHaveBeenCalledTimes(2);
  });
});
