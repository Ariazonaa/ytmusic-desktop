import type { JsonResponse, NetRequest, NetResponse } from "../../shared/types";

/**
 * Fetches JSON for a plugin. Which hosts a plugin may reach is enforced in
 * `createApi`; this only makes sure the request carries nothing about the user.
 */
export async function getJson(url: string): Promise<JsonResponse> {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  const data: unknown = await response.json().catch(() => null);
  return { status: response.status, data };
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** A header name as HTTP defines it. */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE_LENGTH = 2000;
const MAX_BODY_LENGTH = 256 * 1024;
const MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;

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
 * is, and parsed as well if it is JSON.
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
  const text = (await response.text()).slice(0, MAX_RESPONSE_LENGTH);
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: `text` has it.
  }
  return { status: response.status, text, data };
}
