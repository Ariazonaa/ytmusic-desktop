// Security keys for the Google sign-in where the browser has no Web
// Authentication, as WebKitGTK on Linux. Without it Google waits forever at
// "Use your security key". This stands in for `navigator.credentials.get` and
// lets the app ask the key, see `src-tauri/src/webauthn.rs`, which also does
// the browser's checks of origin and relying party.
import { toBase64Url as bytesToBase64Url } from "../base64";
import { t } from "../i18n";

/** The parts of an assertion, binary values as base64url. */
export interface AssertionParts {
  id: string;
  clientDataJson: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
  appIdUsed: boolean;
}

/** The request as the app takes it, binary values as base64url. */
export interface GetRequest {
  challenge: string;
  rpId?: string;
  allowCredentials: string[];
  userVerification?: string;
  timeout?: number;
  appId?: string;
  pin?: string;
}

export interface WebAuthnBackend {
  /** Rejects with "<DOMException name>: <message>", or "PinRequired", or "PinInvalid: <attempts left>". */
  get(request: GetRequest): Promise<AssertionParts>;
  cancel(): Promise<void>;
}

/**
 * Asks for the key's PIN, after a `wrong` one with the attempts left if the
 * key told them. Resolves with null if the user cancels, or the page does
 * through `signal`.
 */
export type AskPin = (
  wrong: boolean,
  attemptsLeft: number | null,
  signal?: AbortSignal | null,
) => Promise<string | null>;

/** The longest wait for the key the app allows, in milliseconds. */
const MAX_TIMEOUT = 300_000;
/** The longest PIN keys take, in bytes of UTF-8. */
const MAX_PIN_BYTES = 63;

export function toBase64Url(source: BufferSource): string {
  return bytesToBase64Url(
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  );
}

export function fromBase64Url(text: string): ArrayBuffer {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The request the app takes, from what the page passed. */
export function toRequest(options: PublicKeyCredentialRequestOptions): GetRequest {
  return {
    challenge: toBase64Url(options.challenge),
    rpId: options.rpId,
    allowCredentials: (options.allowCredentials ?? [])
      .filter((credential) => credential.type === "public-key")
      .map((credential) => toBase64Url(credential.id)),
    userVerification: options.userVerification,
    // Whole milliseconds, which is what the app reads; it allows five minutes at most.
    timeout: Number.isFinite(options.timeout) ? Math.min(Math.max(0, Math.round(options.timeout!)), MAX_TIMEOUT) : undefined,
    appId: (options.extensions as { appid?: string } | undefined)?.appid,
  };
}

/** Turns "<name>: <message>" from the app into the exception the page expects. */
export function toException(error: unknown): DOMException {
  const text = String(error);
  const match = /^([A-Za-z]+Error): (.*)$/s.exec(text);
  if (!match) return new DOMException(text, "NotAllowedError");
  // A TypeError is not a DOMException; the page treats both as a failure.
  const name = match[1] === "TypeError" ? "NotSupportedError" : match[1];
  return new DOMException(match[2], name);
}

/** What the key said about its PIN, or undefined if `error` is no PIN error. */
export function pinRequest(error: unknown): { wrong: boolean; attemptsLeft: number | null } | undefined {
  const text = String(error);
  if (text === "PinRequired") return { wrong: false, attemptsLeft: null };
  if (text === "PinInvalid") return { wrong: true, attemptsLeft: null };
  const match = /^PinInvalid: (\d+)$/.exec(text);
  return match ? { wrong: true, attemptsLeft: Number(match[1]) } : undefined;
}

/** Asks the app until the key answers, the user gives up or the page aborts. */
export async function getAssertion(
  options: PublicKeyCredentialRequestOptions,
  backend: WebAuthnBackend,
  askPin: AskPin,
  signal?: AbortSignal | null,
): Promise<AssertionParts> {
  const request = toRequest(options);
  const aborted = (): DOMException => new DOMException("the request was cancelled", "AbortError");
  if (signal?.aborted) throw aborted();
  const onAbort = (): void => void backend.cancel();
  signal?.addEventListener("abort", onAbort);
  try {
    for (;;) {
      try {
        const parts = await backend.get(request);
        // The page gave up while the key answered: it gets no credential.
        if (signal?.aborted) throw aborted();
        return parts;
      } catch (error) {
        // A cancelled request ends as "not allowed" in the app.
        if (signal?.aborted) throw aborted();
        const pin = pinRequest(error);
        if (!pin) throw toException(error);
        const entered = await askPin(pin.wrong, pin.attemptsLeft, signal);
        // The page may have given up while the dialog was open.
        if (signal?.aborted) throw aborted();
        if (entered === null) throw new DOMException("the PIN was not entered", "NotAllowedError");
        request.pin = entered;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Builds what `navigator.credentials.get` resolves with. `appIdAsked`: the
 * page passed the `appid` extension, whose result browsers then always give.
 */
function toCredential(
  parts: AssertionParts,
  appIdAsked: boolean,
  Credential: { prototype: object },
  Response: { prototype: object },
): unknown {
  const rawId = fromBase64Url(parts.id);
  const response = Object.create(Response.prototype, {
    clientDataJSON: { value: fromBase64Url(parts.clientDataJson), enumerable: true },
    authenticatorData: { value: fromBase64Url(parts.authenticatorData), enumerable: true },
    signature: { value: fromBase64Url(parts.signature), enumerable: true },
    userHandle: { value: parts.userHandle === null ? null : fromBase64Url(parts.userHandle), enumerable: true },
  });
  const extensions = appIdAsked ? { appid: parts.appIdUsed } : {};
  return Object.create(Credential.prototype, {
    id: { value: parts.id, enumerable: true },
    rawId: { value: rawId, enumerable: true },
    type: { value: "public-key", enumerable: true },
    authenticatorAttachment: { value: "cross-platform", enumerable: true },
    response: { value: response, enumerable: true },
    getClientExtensionResults: { value: () => ({ ...extensions }) },
    toJSON: {
      value: () => ({
        id: parts.id,
        rawId: parts.id,
        type: "public-key",
        authenticatorAttachment: "cross-platform",
        response: {
          clientDataJSON: parts.clientDataJson,
          authenticatorData: parts.authenticatorData,
          signature: parts.signature,
          userHandle: parts.userHandle,
        },
        clientExtensionResults: { ...extensions },
      }),
    },
  });
}

/**
 * Gives the page `PublicKeyCredential` and `navigator.credentials.get` for
 * security keys. Does nothing where the browser has its own.
 */
export function installWebAuthn(backend: WebAuthnBackend, askPin: AskPin = askPinInPage, win: Window = window): void {
  const scope = win as unknown as Record<string, unknown>;
  if ("PublicKeyCredential" in scope) return;

  class PublicKeyCredential {
    static isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> {
      return Promise.resolve(false);
    }
    static isConditionalMediationAvailable(): Promise<boolean> {
      return Promise.resolve(false);
    }
  }
  class AuthenticatorAssertionResponse {}
  scope.PublicKeyCredential = PublicKeyCredential;
  scope.AuthenticatorAssertionResponse = AuthenticatorAssertionResponse;

  // A request still waiting for the key when the page goes away ends then,
  // or the key would go on asking for a touch for a page that is gone. This
  // call often does not get through as the page unloads; the app ends the
  // request itself when the next page starts to load.
  let running = 0;
  win.addEventListener("pagehide", () => {
    if (running > 0) void backend.cancel();
  });

  const navigator = win.navigator;
  const existing = (navigator as { credentials?: CredentialsContainer }).credentials;
  const originalGet = existing?.get?.bind(existing);
  const get = async (options?: CredentialRequestOptions): Promise<unknown> => {
    const publicKey = options?.publicKey;
    if (!publicKey) {
      if (originalGet) return originalGet(options);
      throw new DOMException("only security keys are supported", "NotSupportedError");
    }
    if (options.mediation === "conditional") {
      // Offered with the autofill of the username, which is not available
      // here: like a browser without passkeys, wait until the page gives up.
      const signal = options.signal;
      if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    running++;
    try {
      const parts = await getAssertion(publicKey, backend, askPin, options.signal);
      const appIdAsked = (publicKey.extensions as { appid?: string } | undefined)?.appid !== undefined;
      return toCredential(parts, appIdAsked, PublicKeyCredential, AuthenticatorAssertionResponse);
    } finally {
      running--;
    }
  };
  const create = (): Promise<never> =>
    Promise.reject(new DOMException("creating credentials is not supported", "NotSupportedError"));
  if (existing) {
    Object.defineProperty(existing, "get", { value: get, configurable: true, writable: true });
    Object.defineProperty(existing, "create", { value: create, configurable: true, writable: true });
  } else {
    Object.defineProperty(navigator, "credentials", {
      value: { get, create, store: create, preventSilentAccess: () => Promise.resolve() },
      configurable: true,
    });
  }
}

/**
 * Asks for the PIN in a dialog over the page. Styled through the elements'
 * own style, which the sign-in page's content security policy allows, where
 * it would block a style sheet.
 */
export function askPinInPage(
  wrong: boolean,
  attemptsLeft: number | null,
  signal?: AbortSignal | null,
  doc: Document = document,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const backdrop = doc.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0.6)",
    });
    const form = doc.createElement("form");
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    Object.assign(form.style, {
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      width: "min(360px, calc(100vw - 32px))",
      padding: "24px",
      borderRadius: "16px",
      background: "#1f1f1f",
      color: "#e3e3e3",
      font: "14px Roboto, Arial, sans-serif",
      boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
    });
    const title = doc.createElement("div");
    title.textContent = t("Enter the PIN of your security key");
    Object.assign(title.style, { fontSize: "18px", fontWeight: "500" });
    form.setAttribute("aria-label", title.textContent);
    form.appendChild(title);
    const warning = doc.createElement("div");
    warning.style.color = "#f2b8b5";
    warning.hidden = !wrong;
    if (wrong) {
      warning.textContent =
        attemptsLeft === null ? t("Wrong PIN.") : t("Wrong PIN. {count} attempts left.", { count: attemptsLeft });
    }
    form.appendChild(warning);
    const input = doc.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.required = true;
    // What keys take: 4 characters at least, 63 bytes at most (checked on sending).
    input.minLength = 4;
    input.maxLength = MAX_PIN_BYTES;
    Object.assign(input.style, {
      padding: "10px 12px",
      border: "1px solid #8e918f",
      borderRadius: "8px",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      fontSize: "16px",
    });
    form.appendChild(input);
    const buttons = doc.createElement("div");
    Object.assign(buttons.style, { display: "flex", justifyContent: "flex-end", gap: "8px" });
    const button = (label: string, primary: boolean): HTMLButtonElement => {
      const element = doc.createElement("button");
      element.textContent = label;
      element.type = primary ? "submit" : "button";
      Object.assign(element.style, {
        padding: "8px 20px",
        border: "none",
        borderRadius: "20px",
        background: primary ? "#a8c7fa" : "transparent",
        color: primary ? "#062e6f" : "#a8c7fa",
        font: "inherit",
        fontWeight: "500",
        cursor: "pointer",
      });
      return element;
    };
    const cancel = button(t("Cancel"), false);
    buttons.append(cancel, button(t("OK"), true));
    form.appendChild(buttons);
    backdrop.appendChild(form);

    const onAbort = (): void => close(null);
    const close = (pin: string | null): void => {
      signal?.removeEventListener("abort", onAbort);
      backdrop.remove();
      resolve(pin);
    };
    signal?.addEventListener("abort", onAbort);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      // Letters like ä take two bytes, so fewer than 63 of them can be too many.
      if (new TextEncoder().encode(input.value).length > MAX_PIN_BYTES) {
        warning.textContent = t("The PIN is too long.");
        warning.hidden = false;
        return;
      }
      close(input.value);
    });
    cancel.addEventListener("click", () => close(null));
    form.addEventListener("keydown", (event) => {
      // The sign-in page's own keys (Enter sends its form) stay out of it.
      event.stopPropagation();
      if (event.key === "Escape") close(null);
    });
    (doc.body ?? doc.documentElement).appendChild(backdrop);
    input.focus();
  });
}
