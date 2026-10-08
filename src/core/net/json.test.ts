import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRequest, sendRequest } from "./json";

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

  it("gives text answers as text", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("plain", { status: 200 })));
    expect(await sendRequest("https://api.example.org/x", checkRequest({}))).toEqual({ status: 200, text: "plain", data: null });
  });
});
