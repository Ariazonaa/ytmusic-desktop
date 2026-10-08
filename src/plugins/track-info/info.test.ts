import { describe, expect, it } from "vitest";
import { describeTrack, parseCodecs } from "./info";

const formats = [
  { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', averageBitrate: 129569, audioSampleRate: "44100", audioChannels: 2, audioQuality: "AUDIO_QUALITY_MEDIUM" },
  { itag: 141, mimeType: 'audio/mp4; codecs="mp4a.40.2"', averageBitrate: 257589, audioSampleRate: "44100", audioChannels: 2, audioQuality: "AUDIO_QUALITY_HIGH" },
  { itag: 774, mimeType: 'audio/webm; codecs="opus"', bitrate: 270281, audioSampleRate: "48000", audioChannels: 2, audioQuality: "AUDIO_QUALITY_HIGH" },
];

describe("parseCodecs", () => {
  it("reads the audio codec and the format number", () => {
    expect(parseCodecs("0 / mp4a.40.2 (141)")).toEqual({ codec: "mp4a.40.2", itag: 141 });
    expect(parseCodecs("vp09.00.31.08 (248) / opus (251)")).toEqual({ codec: "opus", itag: 251 });
    expect(parseCodecs("opus")).toEqual({ codec: "opus", itag: null });
  });

  it("gives up on anything else", () => {
    expect(parseCodecs(undefined)).toBeNull();
    expect(parseCodecs("")).toBeNull();
    expect(parseCodecs("0 / ")).toBeNull();
  });
});

describe("describeTrack", () => {
  it("describes the format that is playing", () => {
    const rows = describeTrack({
      videoId: "lYBUbBu4W08",
      stats: { codecs: "0 / mp4a.40.2 (141)", bandwidth_kbps: "10037 Kbps", buffer_health_seconds: "39.01 s" },
      formats,
      loudnessLkfs: -15.99,
    });
    expect(Object.fromEntries(rows.map((row) => [row.label, row.value]))).toEqual({
      "Video ID": "lYBUbBu4W08",
      Codec: "AAC (mp4a.40.2)",
      Bitrate: "258 kbit/s",
      "Sample rate": "44.1 kHz",
      Channels: "Stereo",
      Quality: "High",
      "Format number": "141",
      Loudness: "-16.0 LKFS",
      Connection: "10037 kbit/s",
      Buffered: "39.01 s",
    });
  });

  it("falls back to the peak bitrate and names Opus", () => {
    const rows = describeTrack({ videoId: "x", stats: { codecs: "0 / opus (774)" }, formats, loudnessLkfs: null });
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(byLabel.Codec).toBe("Opus (opus)");
    expect(byLabel.Bitrate).toBe("270 kbit/s");
    expect(byLabel["Sample rate"]).toBe("48 kHz");
    expect(byLabel.Loudness).toBeUndefined();
  });

  it("leaves out what the player does not report", () => {
    expect(describeTrack({ videoId: null, stats: null, formats: [], loudnessLkfs: null })).toEqual([]);
    const rows = describeTrack({ videoId: "x", stats: { codecs: "0 / mp4a.40.2 (999)" }, formats, loudnessLkfs: null });
    expect(rows.map((row) => row.label)).toEqual(["Video ID", "Codec", "Format number"]);
  });
});
