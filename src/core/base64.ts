/** Base64 of bytes. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In pieces: one call with a whole picture would exceed the argument limit.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** The URL-safe form without padding, as Web Authentication writes binary values. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
