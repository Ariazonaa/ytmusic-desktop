import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRequest, getJson, readLimited, sendRequest } from "./json";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkRequest", () => {
  it("fills in a plain GET", () => {
    expect(checkRequest(undefined)).toEqual({ method: "GET", headers: {}, body: null });
    expect(checkRequest({})).toEqual({ method: "GET", headers: {}, body: null });
  });

  it("accepts methods, headers and a text body", () => {
    const request = { method: "POST", headers: { Authorization: "Token abc", "Content-Type": "application/json" }, body: '{"a":1}' };
    expect(checkRequest(request)).toEqual(request);
  });

  it("refuses what could do more than asked for", () => {
    const bad: unknown[] = [
      { method: "TRACE" },
      { method: "post" },
      { headers: [] },
      { headers: { "Bad Name": "x" } },
      { headers: { "X-Test": "a\r\nCookie: stolen" } },
      { headers: { "X-Test": 5 } },
      { headers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`X-${i}`, "x"])) },
      { method: "POST", body: { a: 1 } },
      { method: "POST", body: "x".repeat(256 * 1024 + 1) },
      { method: "GET", body: "x" },
    ];
    for (const request of bad) expect(() => checkRequest(request), JSON.stringify(request).slice(0, 60)).toThrow();
  });
});

describe("sendRequest", () => {
  it("sends without cookies, referrer or redirects, and parses JSON answers", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{"ok":true}', { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    const request = checkRequest({ method: "POST", headers: { "X-Test": "1" }, body: "{}" });

    expect(await sendRequest("https://api.example.org/x", request)).toEqual({ status: 201, text: '{"ok":true}', data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.org/x", {
      method: "POST",
      headers: { "X-Test": "1" },
      body: "{}",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
  });

  it("does not follow redirects for getJson either", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{"a":1}', { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getJson("https://example.com/x")).toEqual({ status: 200, data: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/x", {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
  });

  it("gives text answers as text", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("plain", { status: 200 })));
    expect(await sendRequest("https://api.example.org/x", checkRequest({}))).toEqual({ status: 200, text: "plain", data: null });
  });
});

describe("readLimited", () => {
  /** An answer that would never end, counting how much of it was read. */
  function endless(): { response: Response; pulled: () => number; cancelled: () => boolean } {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(1000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    return { response: new Response(body), pulled: () => pulled, cancelled: () => cancelled };
  }

  it("stops reading at the limit and cancels the rest", async () => {
    const { response, pulled, cancelled } = endless();
    const { text, complete } = await readLimited(response, 2500);
    expect(text).toBe("x".repeat(2500));
    expect(complete).toBe(false);
    expect(cancelled()).toBe(true);
    expect(pulled()).toBeLessThan(10);
  });

  it("reads a short answer whole", async () => {
    expect(await readLimited(new Response("äöü"), 100)).toEqual({ text: "äöü", complete: true });
    expect(await readLimited(new Response(null), 100)).toEqual({ text: "", complete: true });
  });

  it("does not garble a character cut at the limit", async () => {
    // "ä" is two bytes: a limit of 4 cuts the second one in half.
    expect(await readLimited(new Response("aää"), 4)).toEqual({ text: "aä", complete: false });
  });

  it("gives no data for a cut answer", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(endless().response));
    const answer = await sendRequest("https://api.example.org/x", checkRequest({}));
    expect(answer.text).toHaveLength(2 * 1024 * 1024);
    expect(answer.data).toBeNull();
    vi.stubGlobal("fetch", () => Promise.resolve(endless().response));
    expect(await getJson("https://api.example.org/x")).toEqual({ status: 200, data: null });
  });
});
