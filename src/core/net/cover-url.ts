/**
 * Whether `url` is the address of a cover on YouTube's image servers, and
 * safe to write into a stylesheet: anything that could end the `url("…")`
 * it is put in is refused.
 */
export function isSafeImageUrl(url: string): boolean {
  if (/["'()\\\s<>]/.test(url)) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/.test(hostname);
  } catch {
    return false;
  }
}
