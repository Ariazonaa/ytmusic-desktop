// End-to-end test: lets a track run into the next one in the real app and
// checks that plugins see the new song, its position and its sound.
//
// YouTube Music plays consecutive tracks through one media stream. At such a
// transition the <video> element's clock keeps counting and the page may swap
// the element, which broke position, duration and the audio chain before.
// Seeking or pressing Next does not go through that path, so this test has to
// wait for a track to end by itself.
//
// Usage: npm run test:e2e, see e2e-lib.mjs for the environment variables.
//
// The app must not be running. The test plays the end of one track and the
// start of the next, silently, in the profile the app normally uses.
import { checklist, connect, launch, preflight, sleep, stop, until } from "./e2e-lib.mjs";

const FIRST_TRACK = "dQw4w9WgXcQ";
const START_URL = `https://music.youtube.com/watch?v=${FIRST_TRACK}&list=RDAMVM${FIRST_TRACK}`;
/** How long before its end the first track is picked up. */
const LEAD_SECONDS = 8;
/** Below this, the audio chain counts as silent. Music sits around -20 dB. */
const SILENCE_DB = -60;

// Routes everything bound for the speakers into a meter and a muted gain, so
// the test is silent and can still tell whether the chain carries sound. The
// video element stays muted for as long as no audio chain has shown up.
const TAP = `(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (!(target instanceof AudioDestinationNode)) return connect.call(this, target, ...rest);
    const context = this.context;
    if (!context.__tap) {
      const input = context.createGain();
      const silence = context.createGain();
      silence.gain.value = 0;
      connect.call(input, silence);
      connect.call(silence, target);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      connect.call(input, analyser);
      context.__tap = input;
      context.__analyser = analyser;
      window.__e2eContext = context;
    }
    return connect.call(this, context.__tap, ...rest);
  };
  setInterval(() => document.querySelectorAll("video").forEach((v) => (v.muted = !window.__e2eContext)), 20);
})()`;

/** Mean level at the end of the audio chain over two seconds, in dB. `null` without a chain. */
const LEVEL = `(async () => {
  const context = window.__e2eContext;
  if (!context) return null;
  const samples = new Float32Array(context.__analyser.fftSize);
  let power = 0, count = 0;
  const end = performance.now() + 2000;
  while (performance.now() < end) {
    context.__analyser.getFloatTimeDomainData(samples);
    for (const sample of samples) power += sample * sample;
    count += samples.length;
    await new Promise((done) => setTimeout(done, 30));
  }
  return Math.round(10 * Math.log10(Math.max(power / count, 1e-14)));
})()`;

/** What the app tells plugins, next to what the page itself shows. */
const SNAPSHOT = `(() => {
  const player = document.querySelector("#movie_player");
  const video = document.querySelector("video");
  return JSON.stringify({
    app: window.__ytmDesktop?.inspect?.() ?? null,
    playerVideoId: player?.getVideoData?.().video_id ?? null,
    pageTitle: navigator.mediaSession.metadata?.title ?? null,
    pageTime: document.querySelector("ytmusic-player-bar .time-info")?.textContent?.trim() ?? null,
    paused: video?.paused ?? null,
    elementClock: video ? Math.round(video.currentTime) : null,
  });
})()`;

/** "1:02:03" or "3:32" in seconds. */
function clockSeconds(text) {
  const parts = text.trim().split(":").map(Number);
  return parts.some(Number.isNaN) ? null : parts.reduce((total, part) => total * 60 + part, 0);
}

/** The page's own time display, "0:05 / 3:32". */
function parsePageTime(text) {
  const [position, duration] = (text ?? "").split("/").map(clockSeconds);
  return position == null || duration == null ? null : { position, duration };
}

async function run(page, check) {
  const { send, evaluate, consoleLines } = page;
  const snapshot = async () => JSON.parse(await evaluate(SNAPSHOT));
  const invoke = (command, args) =>
    evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args ?? {})})`);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: TAP });
  await until(
    "the app's script in the page",
    () => evaluate("Boolean(window.__TAURI_INTERNALS__ && window.__ytmDesktop?.inspect)").catch(() => false),
    40000,
  );
  const original = await invoke("get_settings");
  try {
    // `demo` logs every song change it is told about; `audio-tools` puts the sound through the audio chain.
    await invoke("set_settings", {
      settings: {
        ...original,
        plugins: ["demo", "audio-tools"],
        pluginSettings: { ...original.pluginSettings, demo: { ...original.pluginSettings?.demo, logSongs: true } },
      },
    });
    await send("Page.navigate", { url: START_URL });
    await until("the first track to load", async () => (await snapshot().catch(() => null))?.playerVideoId === FIRST_TRACK, 40000);
    await sleep(2000);
    await evaluate("document.querySelector('video')?.play()", true);
    const first = await until(
      "the first track to play",
      async () => {
        const now = await snapshot();
        return now.paused === false && now.app?.song && now.app.playback?.durationSeconds ? now : null;
      },
      30000,
    );
    console.log(`first track: "${first.app.song.title}", ${Math.round(first.app.playback.durationSeconds)} s`);
    const levelBefore = await evaluate(LEVEL);
    check("sound runs through the audio chain before the transition", levelBefore !== null && levelBefore > SILENCE_DB, `${levelBefore} dB`);

    const logged = consoleLines.length;
    await evaluate(`document.querySelector("#movie_player").seekTo(${first.app.playback.durationSeconds - LEAD_SECONDS}, true)`);
    const changed = await until(
      "the next track to start by itself",
      async () => {
        const now = await snapshot();
        return now.playerVideoId && now.playerVideoId !== FIRST_TRACK ? now : null;
      },
      (LEAD_SECONDS + 40) * 1000,
      250,
    ).catch(() => null);
    check("the next track starts by itself", changed !== null);
    if (!changed) return;

    // Give the new track a few seconds, as a listener would notice problems only then.
    await sleep(6000);
    const after = await snapshot();
    const shown = parsePageTime(after.pageTime);
    const { song, playback, videoId } = after.app ?? {};
    console.log(`second track: "${after.pageTitle}", page shows ${after.pageTime}, <video> clock at ${after.elementClock} s`);

    check("plugins get the new video id", videoId === after.playerVideoId && videoId !== FIRST_TRACK, String(videoId));
    check(
      "plugins get the new song",
      Boolean(song) && song.title === after.pageTitle && song.title !== first.app.song.title,
      `"${song?.title}"`,
    );
    const announcements = consoleLines.slice(logged).filter((line) => line.startsWith("[demo] now playing:"));
    check("plugins are told about the song change exactly once", announcements.length === 1, JSON.stringify(announcements));
    check("the page shows a time to compare with", shown !== null, String(after.pageTime));
    if (shown && playback) {
      check(
        "the position counts from the start of the new track",
        playback.positionSeconds < 30 && Math.abs(playback.positionSeconds - shown.position) <= 3,
        `${playback.positionSeconds.toFixed(1)} s, page shows ${shown.position} s`,
      );
      check(
        "the duration is the new track's",
        playback.durationSeconds !== null && Math.abs(playback.durationSeconds - shown.duration) <= 2,
        `${playback.durationSeconds} s, page shows ${shown.duration} s`,
      );
    } else {
      check("plugins get a playback state", Boolean(playback));
    }
    const levelAfter = await evaluate(LEVEL);
    const later = await snapshot();
    check(
      "playback continues",
      later.paused === false && later.app?.playback?.positionSeconds > (playback?.positionSeconds ?? Infinity) + 1,
      `${playback?.positionSeconds?.toFixed(1)} s -> ${later.app?.playback?.positionSeconds?.toFixed(1)} s`,
    );
    check("sound still runs through the audio chain", levelAfter !== null && levelAfter > SILENCE_DB, `${levelAfter} dB`);
  } finally {
    await evaluate("document.querySelector('video')?.pause()").catch(() => {});
    await invoke("set_settings", { settings: original }).catch((error) => {
      console.error("could not restore the settings:", error.message);
    });
  }
}

async function main() {
  const problem = await preflight();
  if (problem) {
    console.error(problem);
    return 2;
  }
  const { check, finish } = checklist();
  const app = launch();
  let page;
  try {
    page = await connect(app);
    await run(page, check);
  } catch (error) {
    check("the test runs to its end", false, error.message);
  } finally {
    page?.close();
    stop(app);
  }
  return finish();
}

process.exit(await main());
