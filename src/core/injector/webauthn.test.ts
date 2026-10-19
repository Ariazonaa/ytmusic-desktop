import { afterEach, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import {
  askPinInPage,
  fromBase64Url,
  installWebAuthn,
  toBase64Url,
  toRequest,
  type AssertionParts,
  type WebAuthnBackend,
} from "./webauthn";

afterEach(() => {
  setLanguage("en");
  document.body.replaceChildren();
});

const bytes = (...values: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values);

const parts: AssertionParts = {
  id: toBase64Url(bytes(1, 2, 3)),
  clientDataJson: toBase64Url(new TextEncoder().encode('{"type":"webauthn.get"}')),
  authenticatorData: toBase64Url(bytes(4, 5)),
  signature: toBase64Url(bytes(6)),
  userHandle: null,
  appIdUsed: true,
};

/** A window of its own, without Web Authentication, as WebKitGTK's. */
function bareWindow(): Window {
  return { navigator: {} } as unknown as Window;
}

function backend(get: WebAuthnBackend["get"]): WebAuthnBackend {
  return { get: vi.fn(get), cancel: vi.fn(() => Promise.resolve()) };
}

const options = (extra: Partial<PublicKeyCredentialRequestOptions> = {}): CredentialRequestOptions => ({
  publicKey: {
    challenge: bytes(...Array<number>(32).fill(7)),
    rpId: "google.com",
    allowCredentials: [{ type: "public-key", id: bytes(1, 2, 3) }],
    userVerification: "discouraged",
    ...extra,
  },
});

it("encodes base64url without padding and back", () => {
  const value = bytes(0xfb, 0xff, 0xfe, 0x01);
  expect(toBase64Url(value)).toBe("-__-AQ");
  expect(new Uint8Array(fromBase64Url("-__-AQ"))).toEqual(value);
  // A view onto part of a buffer is only that part.
  expect(toBase64Url(new Uint8Array(value.buffer, 1, 2))).toBe("__4");
});

it("hands the page's request to the app", () => {
  const request = toRequest({
    ...options().publicKey!,
    extensions: { appid: "https://www.gstatic.com/securitykey/origins.json" } as AuthenticationExtensionsClientInputs,
  });
  expect(request).toEqual({
    challenge: toBase64Url(bytes(...Array<number>(32).fill(7))),
    rpId: "google.com",
    allowCredentials: ["AQID"],
    userVerification: "discouraged",
    timeout: undefined,
    appId: "https://www.gstatic.com/securitykey/origins.json",
  });
});

it("gives the page a credential as a browser would", async () => {
  const win = bareWindow();
  installWebAuthn(backend(() => Promise.resolve(parts)), vi.fn(), win);
  const scope = win as unknown as { PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> } };
  expect(await scope.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(false);

  const credential = (await win.navigator.credentials.get(options())) as PublicKeyCredential;
  expect(credential).toBeInstanceOf(scope.PublicKeyCredential as unknown as typeof Object);
  expect(credential.id).toBe("AQID");
  expect(credential.type).toBe("public-key");
  expect(new Uint8Array(credential.rawId)).toEqual(bytes(1, 2, 3));
  const response = credential.response as AuthenticatorAssertionResponse;
  expect(new Uint8Array(response.authenticatorData)).toEqual(bytes(4, 5));
  expect(new Uint8Array(response.signature)).toEqual(bytes(6));
  expect(response.userHandle).toBeNull();
  expect(credential.getClientExtensionResults()).toEqual({ appid: true });
});

it("leaves a browser with its own Web Authentication alone", () => {
  const own = class {};
  const win = { navigator: {}, PublicKeyCredential: own } as unknown as Window;
  installWebAuthn(backend(() => Promise.resolve(parts)), vi.fn(), win);
  expect((win as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential).toBe(own);
  expect(win.navigator.credentials).toBeUndefined();
});

it("asks for the PIN when the key wants it, and again when it was wrong", async () => {
  const answers = ["PinRequired", "PinInvalid: 2"];
  const app = backend((request) => {
    const answer = answers.shift();
    return answer ? Promise.reject(answer) : Promise.resolve({ ...parts, id: request.pin ?? "" });
  });
  const askPin = vi.fn().mockResolvedValueOnce("1111").mockResolvedValueOnce("2222");
  const win = bareWindow();
  installWebAuthn(app, askPin, win);
  const credential = (await win.navigator.credentials.get(options())) as PublicKeyCredential;
  expect(askPin.mock.calls).toEqual([
    [false, null],
    [true, 2],
  ]);
  expect(credential.id).toBe("2222");
});

it("fails as the page expects when the key refuses or the PIN is not given", async () => {
  const win = bareWindow();
  installWebAuthn(backend(() => Promise.reject("NotAllowedError: timed out")), vi.fn(), win);
  await expect(win.navigator.credentials.get(options())).rejects.toMatchObject({
    name: "NotAllowedError",
    message: "timed out",
  });

  const other = bareWindow();
  installWebAuthn(backend(() => Promise.reject("PinRequired")), vi.fn().mockResolvedValue(null), other);
  await expect(other.navigator.credentials.get(options())).rejects.toMatchObject({ name: "NotAllowedError" });
});

it("cancels the key's request when the page aborts", async () => {
  const controller = new AbortController();
  const app = backend(() => new Promise((_, reject) => setTimeout(() => reject("NotAllowedError: the operation either timed out or was not allowed"), 10)));
  const win = bareWindow();
  installWebAuthn(app, vi.fn(), win);
  const pending = win.navigator.credentials.get({ ...options(), signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(app.cancel).toHaveBeenCalledOnce();
});

it("does not create credentials", async () => {
  const win = bareWindow();
  installWebAuthn(backend(() => Promise.resolve(parts)), vi.fn(), win);
  await expect(win.navigator.credentials.create({})).rejects.toMatchObject({ name: "NotSupportedError" });
});

it("asks for the PIN in a dialog in the page's language", async () => {
  setLanguage("de");
  const pending = askPinInPage(true, 3);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("PIN deines Sicherheitsschlüssels eingeben");
  expect(dialog.textContent).toContain("Noch 3 Versuche");
  document.querySelector("input")!.value = "123456";
  (dialog as HTMLFormElement).requestSubmit();
  expect(await pending).toBe("123456");
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  const cancelled = askPinInPage(false, null);
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Falsche");
  document.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
  expect(await cancelled).toBeNull();
});
