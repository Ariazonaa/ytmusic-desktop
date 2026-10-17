import { describe, expect, it, vi } from "vitest";
import { QuotaError, blocks, translateLines, translateUrl } from "./translate";

/** A translation service that turns each line into "DE: line", in German from English. */
function service(options: { detected?: string; breakLines?: boolean; quota?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    if (options.quota) return { status: 200, data: { quotaFinished: true } };
    const lines = q.split("\n").map((line) => `DE: ${line}`);
    return {
      status: 200,
      data: {
        quotaFinished: false,
        responseData: { translatedText: options.breakLines && lines.length > 1 ? lines.join(" ") : lines.join("\n"), detectedLanguage: options.detected ?? "en" },
      },
    };
  });
}

describe("blocks", () => {
  it("puts lines together up to the size of a request, without the empty ones", () => {
    expect(blocks(["a", "", "b", "c"])).toEqual([[0, 2, 3]]);
    const long = "x".repeat(300);
    expect(blocks([long, long, "y"])).toEqual([[0], [1, 2]]);
  });
});

describe("translateLines", () => {
  it("translates each line and keeps the empty ones", async () => {
    const getJson = service();
    expect(await translateLines(getJson, ["I got this feeling", "", "inside my bones"], "de")).toEqual([
      "DE: I got this feeling",
      "",
      "DE: inside my bones",
    ]);
    expect(getJson).toHaveBeenCalledOnce();
    expect(getJson.mock.calls[0]?.[0]).toBe(translateUrl("I got this feeling\ninside my bones", "de"));
  });

  it("goes line by line when the service loses the line breaks", async () => {
    const getJson = service({ breakLines: true });
    expect(await translateLines(getJson, ["one", "two"], "de")).toEqual(["DE: one", "DE: two"]);
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("leaves out a line that came back untranslated", async () => {
    const getJson = vi.fn(async () => ({
      status: 200,
      data: { responseData: { translatedText: "I 'm hurtin', baby\nIch brauche dich", detectedLanguage: "en" } },
    }));
    expect(await translateLines(getJson, ["I'm hurtin', baby", "I need you"], "de")).toEqual(["", "Ich brauche dich"]);
  });

  it("says when the lyrics are in the language already", async () => {
    expect(await translateLines(service({ detected: "de" }), ["Ich hab dich gesucht"], "de")).toBeNull();
    expect(await translateLines(service({ detected: "de-DE" }), ["Ich hab dich gesucht"], "de")).toBeNull();
  });

  it("says when the day's amount is used up", async () => {
    await expect(translateLines(service({ quota: true }), ["one"], "de")).rejects.toBeInstanceOf(QuotaError);
  });
});
