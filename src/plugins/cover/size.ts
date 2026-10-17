// The cover at the largest size YouTube's image servers hand out.

/** Square, as YouTube Music shows covers; larger ones are scaled from this. */
const SIZE = 1200;

/**
 * The address of the same cover, large. Covers of songs come from
 * googleusercontent.com or ggpht.com with their size at the end
 * (`=w60-h60-l90-rj`); pictures of videos from i.ytimg.com, as files of fixed
 * sizes. Anything else is returned as it is.
 */
export function largeCover(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (/(^|\.)(googleusercontent\.com|ggpht\.com)$/.test(parsed.hostname)) {
    const [path] = parsed.pathname.split("=");
    return `${parsed.origin}${path}=w${SIZE}-h${SIZE}-l90-rj`;
  }
  if (/(^|\.)ytimg\.com$/.test(parsed.hostname)) {
    const match = parsed.pathname.match(/^\/vi(?:_webp)?\/([\w-]+)\//);
    if (match) return `https://i.ytimg.com/vi/${match[1]}/maxresdefault.jpg`;
  }
  return url;
}

/** The smaller picture to fall back to when a video has no `maxresdefault`. */
export function fallbackCover(url: string): string | null {
  const match = url.match(/^https:\/\/i\.ytimg\.com\/vi\/([\w-]+)\/maxresdefault\.jpg$/);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}
