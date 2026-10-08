// Turns what the player reports about the playing track into rows to show.

/** One audio format a track is offered in, as listed in the player's response. */
export interface AudioFormat {
  itag?: unknown;
  mimeType?: unknown;
  averageBitrate?: unknown;
  bitrate?: unknown;
  audioSampleRate?: unknown;
  audioChannels?: unknown;
  audioQuality?: unknown;
}

/** The player's "stats for nerds", as far as they are used here. */
export interface PlayerStats {
  /** `"0 / mp4a.40.2 (141)"`: video codec, audio codec and the audio format's number. */
  codecs?: unknown;
  bandwidth_kbps?: unknown;
  buffer_health_seconds?: unknown;
}

export interface Row {
  label: string;
  value: string;
}

const CODEC_NAMES: [RegExp, string][] = [
  [/^mp4a/, "AAC"],
  [/^opus/, "Opus"],
  [/^ec-3|^ac-3/, "Dolby Digital"],
  [/^vorbis/, "Vorbis"],
];
const QUALITY_NAMES: Readonly<Record<string, string>> = {
  AUDIO_QUALITY_LOW: "Low",
  AUDIO_QUALITY_MEDIUM: "Normal",
  AUDIO_QUALITY_HIGH: "High",
};

/** The audio codec and format number from the stats' `codecs` text. */
export function parseCodecs(codecs: unknown): { codec: string; itag: number | null } | null {
  if (typeof codecs !== "string") return null;
  const audio = codecs.split("/").at(-1)?.trim() ?? "";
  const match = /^([\w.-]+)(?:\s*\((\d+)\))?$/.exec(audio);
  if (!match?.[1]) return null;
  return { codec: match[1], itag: match[2] ? Number(match[2]) : null };
}

const codecName = (codec: string): string => {
  const known = CODEC_NAMES.find(([pattern]) => pattern.test(codec))?.[1];
  return known ? `${known} (${codec})` : codec;
};

const finite = (value: unknown): number | null => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
};

/** The rows for the panel. What the player does not report is left out. */
export function describeTrack(input: {
  videoId: string | null;
  stats: PlayerStats | null;
  formats: readonly AudioFormat[];
  loudnessLkfs: number | null;
}): Row[] {
  const rows: Row[] = [];
  const add = (label: string, value: string | null): void => {
    if (value) rows.push({ label, value });
  };
  const playing = parseCodecs(input.stats?.codecs);
  const format = playing?.itag != null ? input.formats.find((entry) => finite(entry.itag) === playing.itag) : undefined;

  add("Video ID", input.videoId);
  add("Codec", playing ? codecName(playing.codec) : null);
  const bitrate = finite(format?.averageBitrate) ?? finite(format?.bitrate);
  add("Bitrate", bitrate !== null ? `${Math.round(bitrate / 1000)} kbit/s` : null);
  const sampleRate = finite(format?.audioSampleRate);
  add("Sample rate", sampleRate !== null ? `${sampleRate / 1000} kHz` : null);
  const channels = finite(format?.audioChannels);
  add("Channels", channels !== null ? (channels === 2 ? "Stereo" : channels === 1 ? "Mono" : String(channels)) : null);
  add("Quality", typeof format?.audioQuality === "string" ? (QUALITY_NAMES[format.audioQuality] ?? format.audioQuality) : null);
  add("Format number", playing?.itag != null ? String(playing.itag) : null);
  add("Loudness", input.loudnessLkfs !== null ? `${input.loudnessLkfs.toFixed(1)} LKFS` : null);
  add("Connection", typeof input.stats?.bandwidth_kbps === "string" ? input.stats.bandwidth_kbps.replace("Kbps", "kbit/s") : null);
  add("Buffered", typeof input.stats?.buffer_health_seconds === "string" ? input.stats.buffer_health_seconds : null);
  return rows;
}
