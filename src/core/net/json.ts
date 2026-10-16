import type { JsonResponse, NetRequest, NetResponse } from "../../shared/types";

/** An answer longer than this is cut off, and then not parsed. */
const MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;

/**
 * Fetches JSON for a plugin. Which hosts a plugin may reach is enforced in
 * `createApi`; this only makes sure the request carries nothing about the user.
 */
export async function getJson(url: string): Promise<JsonResponse> {
  const response = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    // A redirect could lead to a host the plugin may not contact.
    redirect: "error",
  });
  const { text, complete } = await readLimited(response, MAX_RESPONSE_LENGTH);
  return { status: response.status, data: complete ? parseJson(text) : null };
}

/**
 * Reads at most `maxBytes` of an answer and stops the download there, so that
 * a huge answer does not have to arrive, nor fit in memory, before it is cut.
 */
export async function readLimited(response: Response, maxBytes: number): Promise<{ text: string; complete: boolean }> {
  if (!response.body) return { text: "", complete: true };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - length));
      length = maxBytes;
      complete = false;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    length += value.length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  // `stream` leaves a character cut in two at the end out instead of garbling it.
  return { text: new TextDecoder().decode(bytes, { stream: !complete }), complete };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** A header name as HTTP defines it. */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE_LENGTH = 2000;
const MAX_BODY_LENGTH = 256 * 1024;

/**
 * Checks a request a plugin wants to make and returns it in a fixed shape.
 * Throws with a message for the plugin's author if something is not allowed.
 */
export function checkRequest(request: unknown): Required<NetRequest> {
  const { method = "GET", headers = {}, body = null } = (request ?? {}) as Record<string, unknown>;
  if (typeof method !== "string" || !METHODS.includes(method)) {
    throw new Error(`method must be one of ${METHODS.join(", ")}`);
  }
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw new Error("headers must be an object");
  }
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADERS) throw new Error(`at most ${MAX_HEADERS} headers`);
  const checked: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw new Error(`invalid header name: ${JSON.stringify(name)}`);
    // A line break in a value would start a header of its own.
    if (typeof value !== "string" || value.length > MAX_HEADER_VALUE_LENGTH || /[\r\n\0]/.test(value)) {
      throw new Error(`invalid value for header ${name}`);
    }
    checked[name] = value;
  }
  if (body !== null && typeof body !== "string") throw new Error("body must be a string; use JSON.stringify for JSON");
  if (typeof body === "string" && body.length > MAX_BODY_LENGTH) throw new Error("body is too large");
  if (body !== null && method === "GET") throw new Error("a GET request has no body");
  return { method: method as NetRequest["method"] & string, headers: checked, body };
}

/**
 * Makes a request for a plugin, without cookies and without a referrer.
 * `request` must have passed `checkRequest`. The answer's text is given as it
 * is, and parsed as well if it is JSON and complete.
 */
export async function sendRequest(url: string, request: Required<NetRequest>): Promise<NetResponse> {
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    // A redirect could lead to a host the plugin may not contact.
    redirect: "error",
  });
  const { text, complete } = await readLimited(response, MAX_RESPONSE_LENGTH);
  return { status: response.status, text, data: complete ? parseJson(text) : null };
}
