// Keeps track of which device the sound goes to. The browser only says that
// the devices changed, not which one is in use, so the backend is asked for
// the name each time.

const SETTLE_MS = 700;

type Listener = (device: string | null) => void;

export class OutputDeviceWatcher {
  private device: string | null = null;
  private known = false;
  private readonly listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  constructor(
    private readonly ask: () => Promise<string | null>,
    private readonly devices: Pick<EventTarget, "addEventListener"> | undefined = navigator.mediaDevices,
  ) {}

  /** The device's name as the system shows it, or `null` if it is not known. Asks the backend the first time. */
  async current(): Promise<string | null> {
    if (!this.known) await this.refresh();
    return this.device;
  }

  /**
   * Calls `listener` whenever sound starts going to another device. Returns
   * a function that stops that.
   */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    if (!this.started) {
      this.started = true;
      // Plugging in headphones raises several of these; one look after they settle is enough.
      this.devices?.addEventListener("devicechange", () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.refresh(), SETTLE_MS);
      });
    }
    return () => this.listeners.delete(listener);
  }

  private async refresh(): Promise<void> {
    const before = this.device;
    const wasKnown = this.known;
    this.device = await this.ask().catch(() => null);
    this.known = true;
    if (wasKnown && this.device !== before) {
      for (const listener of [...this.listeners]) listener(this.device);
    }
  }
}
