// Counts how long the playing track is actually heard.

export interface Heard {
  videoId: string;
  title: string;
  artist: string;
  seconds: number;
  day: string;
}

/** The local day, as the statistics keep it: `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The last `count` local days up to `today`, oldest first. */
export function lastDays(today: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (count - 1 - i));
    return localDay(day);
  });
}

/** The track that plays and how many seconds of it were heard so far. */
export class Listening {
  private current: Omit<Heard, "seconds" | "day"> | null = null;
  private seconds = 0;

  /** A new track starts: returns what was heard of the one before, if anything. */
  start(track: Omit<Heard, "seconds" | "day"> | null, now: Date): Heard | null {
    const done = this.finish(now);
    this.current = track;
    return done;
  }

  /** One more second heard, if something plays. */
  tick(playing: boolean): void {
    if (playing && this.current) this.seconds += 1;
  }

  /** What was heard of the current track, which then counts from zero again. */
  finish(now: Date): Heard | null {
    const heard = this.current && this.seconds > 0 ? { ...this.current, seconds: this.seconds, day: localDay(now) } : null;
    this.seconds = 0;
    return heard;
  }
}
