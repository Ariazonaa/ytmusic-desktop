// What the mini player shows of the state the backend sends (`mini.rs`).

export interface MiniState {
  title: string;
  artist: string;
  cover: string | null;
  paused: boolean;
  /** Seconds into the track at `at`. */
  position: number;
  duration: number | null;
  /** When `position` was true, in milliseconds since 1970. */
  at: number;
}

/** Where the track is now: counted on from the last report while it plays. */
export function positionNow(state: MiniState, now: number): number {
  const position = state.paused ? state.position : state.position + Math.max(0, now - state.at) / 1000;
  return state.duration !== null ? Math.min(position, state.duration) : position;
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const s = String(whole % 60).padStart(2, "0");
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The progress as a share from 0 to 1; 0 without a known length. */
export function share(state: MiniState, now: number): number {
  if (state.duration === null || state.duration <= 0) return 0;
  return Math.min(1, Math.max(0, positionNow(state, now) / state.duration));
}

/** Texts of the buttons, in German where the system is. */
export function labels(language: string): Record<"previous" | "play" | "pause" | "next" | "main" | "close" | "nothing", string> {
  return language.toLowerCase().startsWith("de")
    ? { previous: "Zurück", play: "Wiedergabe", pause: "Pause", next: "Weiter", main: "Hauptfenster", close: "Schließen", nothing: "Es läuft nichts" }
    : { previous: "Previous", play: "Play", pause: "Pause", next: "Next", main: "Main window", close: "Close", nothing: "Nothing playing" };
}
