import { describe, expect, it } from "vitest";
import { Listening, lastDays, localDay } from "./listening";

const day = new Date(2026, 9, 17, 12);
const sugar = { videoId: "09R8_2nJtjg", title: "Sugar", artist: "Maroon 5" };
const other = { videoId: "kJQP7kiw5Fk", title: "Despacito", artist: "Luis Fonsi" };

describe("Listening", () => {
  it("reports the seconds heard of a track when the next one starts", () => {
    const listening = new Listening();
    expect(listening.start(sugar, day)).toBeNull();
    for (let i = 0; i < 40; i++) listening.tick(true);
    listening.tick(false);
    expect(listening.start(other, day)).toEqual({ ...sugar, seconds: 40, day: "2026-10-17" });
    expect(listening.finish(day)).toBeNull();
  });

  it("counts nothing without a track", () => {
    const listening = new Listening();
    listening.tick(true);
    expect(listening.start(sugar, day)).toBeNull();
  });

  it("writes the local day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("lists the last days up to today, over the end of a month", () => {
    expect(lastDays(new Date(2026, 9, 2, 12), 3)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});
