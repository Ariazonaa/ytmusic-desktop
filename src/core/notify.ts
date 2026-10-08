// Notifications of the operating system for plugins: fetches the picture and
// remembers what to do when a notification is clicked.
import type { NotifyOptions } from "../shared/types";
import { isSafeImageUrl } from "./net/cover-url";

const MAX_IMAGE_BYTES = 1024 * 1024;
/** Clicks are only awaited for the newest notifications. */
const MAX_PENDING_CLICKS = 20;

/** Sends a notification to the backend. `image` is a file in base64. */
type Send = (title: string, body: string, image: string | null, clickId: number | null) => Promise<void>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In pieces: one call with a whole picture would exceed the argument limit.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/**
 * Loads a cover for a notification. Only covers from YouTube's image servers
 * are loaded, without cookies. Anything else, and any failure, gives `null`:
 * the notification is then shown without a picture.
 */
export async function loadImage(url: unknown): Promise<string | null> {
  if (typeof url !== "string" || !isSafeImageUrl(url)) return null;
  try {
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES ? toBase64(bytes) : null;
  } catch {
    return null;
  }
}

export class Notifier {
  private readonly clicks = new Map<number, () => void>();
  private nextId = 1;

  constructor(private readonly send: Send) {}

  /** Shows a notification. Rejects if the backend refuses it, e.g. for coming too soon after another. */
  async show(title: string, body = "", options: NotifyOptions = {}): Promise<void> {
    const image = await loadImage(options.imageUrl);
    let clickId: number | null = null;
    if (typeof options.onClick === "function") {
      clickId = this.nextId++;
      this.clicks.set(clickId, options.onClick);
      // The oldest are dropped; their notifications have long gone.
      for (const id of [...this.clicks.keys()].slice(0, -MAX_PENDING_CLICKS)) this.clicks.delete(id);
    }
    try {
      await this.send(title, body, image, clickId);
    } catch (error) {
      if (clickId !== null) this.clicks.delete(clickId);
      throw error;
    }
  }

  /** Called when the backend reports a click. Runs the handler once. */
  clicked(id: number): void {
    const handler = this.clicks.get(id);
    this.clicks.delete(id);
    handler?.();
  }
}
