// The device the sound goes to on Windows, where the page sends it there
// itself (`setSinkId`); on Linux the app moves the sound server's streams
// instead. Devices are named the way Windows names them; the page lists them
// with a suffix such as " (Bluetooth)". The page sees the devices only while
// it has the microphone permission, which the app grants while a device is
// chosen. The page cannot open the microphone itself: see `blockMicrophone`.

/** What `enumerateDevices` lists, as far as it is needed here. */
export interface DeviceInfo {
  kind: string;
  label: string;
  deviceId: string;
}

/** Entries that stand for another device, not for one of their own. */
const STAND_INS = ["default", "communications"];

/** Whether the page's label names the device Windows calls `name`. */
export function labelMatches(label: string, name: string): boolean {
  return label === name || label.startsWith(`${name} (`);
}

/** The page's id for the device Windows calls `name`; "" for the default, null if it is not there. */
export function deviceIdFor(devices: readonly DeviceInfo[], name: string): string | null {
  if (name === "") return "";
  const device = devices.find(
    (device) => device.kind === "audiooutput" && !STAND_INS.includes(device.deviceId) && labelMatches(device.label, name),
  );
  return device?.deviceId ?? null;
}

interface Chain {
  readonly tapped: boolean;
  setSink(id: string): Promise<void>;
}
type Sinkable = HTMLMediaElement & { sinkId?: string; setSinkId?(id: string): Promise<void> };
type Logger = Pick<Console, "error">;

export class OutputSwitch {
  private name = "";
  private id = "";
  private watching = false;

  constructor(
    private readonly chain: Chain,
    private readonly doc: Document = document,
    private readonly devices: Pick<MediaDevices, "enumerateDevices" | "addEventListener"> | undefined = navigator.mediaDevices,
    private readonly log: Logger = console,
  ) {}

  /** Sends the sound to the device Windows calls `name`, or to the default for "". */
  async set(name: string): Promise<void> {
    this.name = name;
    this.watch();
    const id = name === "" ? "" : deviceIdFor((await this.devices?.enumerateDevices()) ?? [], name);
    if (id === null) {
      // Unplugged: the sound stays where it is, and goes there once it is back.
      this.log.error("[ytm-desktop] the sound device is not there:", name);
      return;
    }
    this.id = id;
    await this.apply();
  }

  private async apply(): Promise<void> {
    await this.chain.setSink(this.id);
    // Once the chain has the sound, the element's own output is silent and takes no device.
    if (this.chain.tapped) return;
    const video = this.doc.querySelector("video") as Sinkable | null;
    if (video?.setSinkId && video.sinkId !== this.id) await video.setSinkId(this.id);
  }

  private watch(): void {
    if (this.watching) return;
    this.watching = true;
    // A device plugged in again, and a player made anew, get the sound again.
    this.devices?.addEventListener("devicechange", () => {
      if (this.name !== "") void this.set(this.name).catch((error: unknown) => this.fail(error));
    });
    this.doc.addEventListener("play", () => void this.apply().catch((error: unknown) => this.fail(error)), true);
  }

  private fail(error: unknown): void {
    this.log.error("[ytm-desktop] cannot send the sound to its device", error);
  }
}

/**
 * Keeps the page from opening the microphone, also while it has the
 * permission for the sake of the device list. YouTube Music needs neither.
 */
export function blockMicrophone(win: Window = window): void {
  const refuse = (): Promise<never> => Promise.reject(new DOMException("The microphone is not available", "NotAllowedError"));
  const devices = win.navigator.mediaDevices as MediaDevices | undefined;
  if (devices) {
    for (const target of [devices, Object.getPrototypeOf(devices) as object]) {
      Object.defineProperty(target, "getUserMedia", { value: refuse, configurable: false, writable: false });
    }
  }
  for (const legacy of ["getUserMedia", "webkitGetUserMedia"]) {
    if (legacy in win.navigator) Object.defineProperty(win.navigator, legacy, { value: refuse, configurable: false });
  }
}
