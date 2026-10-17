import { describe, expect, it } from "vitest";
import { asCsv, asText, doubles, readAnswer, type PlaylistTrack } from "./tracks";

const runs = (text: string) => ({ runs: [{ text }] });
const item = (videoId: string, title: string, artist: string, album: string, duration: string) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId },
    flexColumns: [title, artist, album].map((text) => ({ musicResponsiveListItemFlexColumnRenderer: { text: runs(text) } })),
    fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: runs(duration) } }],
  },
});

describe("readAnswer", () => {
  it("finds the tracks and the next part wherever they sit", () => {
    const answer = {
      contents: {
        deep: [
          {
            musicPlaylistShelfRenderer: {
              contents: [item("aaaaaaaaaaa", "Sugar", "Maroon 5", "V", "5:02"), item("bbbbbbbbbbb", "Despacito", "Luis Fonsi", "Vida", "4:42")],
            },
          },
          { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "NEXT" } } } },
        ],
      },
    };
    const { tracks, next } = readAnswer(answer);
    expect(tracks).toEqual([
      { videoId: "aaaaaaaaaaa", title: "Sugar", artist: "Maroon 5", album: "V", duration: "5:02" },
      { videoId: "bbbbbbbbbbb", title: "Despacito", artist: "Luis Fonsi", album: "Vida", duration: "4:42" },
    ]);
    expect(next).toBe("NEXT");
  });

  it("takes the video id from a play button, and says when there is no more", () => {
    const answer = {
      musicResponsiveListItemRenderer: {
        overlay: { play: { watchEndpoint: { videoId: "ccccccccccc" } } },
        flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: runs("Song") } }],
      },
    };
    expect(readAnswer(answer)).toEqual({
      tracks: [{ videoId: "ccccccccccc", title: "Song", artist: "", album: "", duration: "" }],
      next: null,
    });
    expect(readAnswer(null)).toEqual({ tracks: [], next: null });
  });
});

const track = (videoId: string | null, title: string, artist: string): PlaylistTrack => ({
  videoId,
  title,
  artist,
  album: "",
  duration: "3:00",
});

describe("export", () => {
  it.each(["=1+1", "+1+1", "-1+1", "@SUM(1)", "\t=1+1", "\r=1+1", "\n=1+1", "  =1+1", "\u0000=1+1"])(
    "exports formula-like metadata %j as text",
    (value) => {
      const quoted = /[",\n\r]/.test(value) ? `"'${value}"` : `'${value}`;
      const row = { videoId: null, title: value, artist: value, album: value, duration: value };
      expect(asCsv([row])).toBe(`Title,Artist,Album,Duration,Link\r\n${quoted},${quoted},${quoted},${quoted},\r\n`);
      expect(asText("Mix", [row])).toBe(`Mix\n\n${value} – ${value}\n`);
    },
  );

  it("writes text and CSV", () => {
    const tracks = [track("aaaaaaaaaaa", "Sugar", "Maroon 5"), track(null, 'Say "Hi", again', "A, B")];
    expect(asText("Mix", tracks)).toBe('Mix\n\nMaroon 5 – Sugar\nA, B – Say "Hi", again\n');
    expect(asCsv(tracks)).toBe(
      'Title,Artist,Album,Duration,Link\r\nSugar,Maroon 5,,3:00,https://music.youtube.com/watch?v=aaaaaaaaaaa\r\n"Say ""Hi"", again","A, B",,3:00,\r\n',
    );
  });
});

describe("doubles", () => {
  it("finds the same video and the same song in another version", () => {
    const tracks = [
      track("aaaaaaaaaaa", "Sugar", "Maroon 5"),
      track("bbbbbbbbbbb", "Despacito", "Luis Fonsi"),
      track("aaaaaaaaaaa", "Sugar", "Maroon 5"),
      track("ccccccccccc", "Sugar (Official Music Video)", "Maroon 5"),
      track("ddddddddddd", "Sugar", "Someone Else"),
    ];
    expect(doubles(tracks).map((group) => group.positions)).toEqual([[1, 3, 4]]);
  });
});
