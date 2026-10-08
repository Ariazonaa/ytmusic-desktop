// End-to-end test of what happens when the real app starts: the track from
// last time comes back, paused where it stopped, and a launch at sign-in
// with "start in the tray" opens no window.
//
// Usage: npm run test:e2e (after e2e-transition.mjs), see e2e-lib.mjs for the
// environment variables. The app must not be running. The test plays some
// seconds of one track, silently, in the profile the app normally uses, and
// puts settings and the remembered track back afterwards.
import { checklist, closeWindow, connect, launch, preflight, sleep, stop, until } from "./e2e-lib.mjs";

const TRACK = "lYBUbBu4W08";
const START_URL = `https://music.youtube.com/watch?v=${TRACK}&list=RDAMVM${TRACK}`;
const SEEK_TO = 60;
/** The app saves the position every five seconds. */
const SAVE_WAIT_MS = 8000;

const MUTE = "window.__e2eMute ??= setInterval(() => document.querySelectorAll('video').forEach((v) => (v.muted = true)), 50)";
const SNAPSHOT = `(() => {
  const player = document.querySelector("#movie_player");
  const video = document.querySelector("video");
  return JSON.stringify({
    videoId: player?.getVideoData?.().video_id ?? null,
    position: typeof player?.getCurrentTime === "function" ? player.getCurrentTime() : null,
    paused: video?.paused ?? null,
    visibility: document.visibilityState,
  });
})()`;

async function main() {
  const problem = await preflight();
  if (problem) {
    console.error(problem);
    return 2;
  }
  const { check, finish } = checklist();
  let app;
  let page;
  let original;
  let rememberedBefore;
  const snapshot = async () => JSON.parse(await page.evaluate(SNAPSHOT));
  const start = async (args) => {
    app = launch(args);
    page = await connect(app);
  };

  try {
    // First run: play a track to a known position and close the window.
    await start();
    original = await page.invoke("get_settings");
    rememberedBefore = await page.evaluate("localStorage.getItem('ytmd-resume')");
    await page.invoke("set_settings", {
      // With "minimize to tray" off, closing the window ends the app the regular way.
      settings: { ...original, plugins: [], resumePlayback: true, startInTray: true, minimizeToTray: false },
    });
    await page.send("Page.navigate", { url: START_URL });
    await until("the track to load", async () => (await snapshot().catch(() => null))?.videoId === TRACK, 40000);
    await sleep(2000);
    await page.evaluate(MUTE);
    await page.evaluate("document.querySelector('video')?.play()", true);
    await until("the track to play", async () => (await snapshot()).paused === false, 30000);
    await page.evaluate(`document.querySelector("#movie_player").seekTo(${SEEK_TO}, true)`);
    await sleep(SAVE_WAIT_MS);
    const left = await snapshot();
    page.close();
    check("closing the window ends the app when it does not minimize to the tray", await closeWindow(app));
    stop(app);

    // Second run, started by hand.
    await start();
    const back = await until(
      "the track from last time",
      async () => {
        const now = await snapshot();
        return now.videoId === TRACK && now.position >= SEEK_TO - 5 ? now : null;
      },
      40000,
    ).catch(() => null);
    const now = back ?? (await snapshot());
    check("the track from last time is loaded again", now.videoId === TRACK, String(now.videoId));
    check(
      "at the position it stopped at",
      back !== null && Math.abs(now.position - left.position) <= 7,
      `${Number(now.position).toFixed(1)} s, left at ${Number(left.position).toFixed(1)} s`,
    );
    await sleep(6000);
    const later = await snapshot();
    check("and stays paused", later.paused === true && Math.abs(later.position - now.position) < 1, `paused: ${later.paused}`);
    check("a start by hand shows the window", later.visibility === "visible", later.visibility);
    page.close();
    check("the app closes again", await closeWindow(app));
    stop(app);

    // Third run, started the way Windows does at sign-in.
    await start(["--autostart"]);
    await sleep(3000);
    const hidden = await snapshot();
    check("a launch at sign-in opens no window with \"start in the tray\" on", hidden.visibility === "hidden", hidden.visibility);
  } catch (error) {
    check("the test runs to its end", false, error.message);
  } finally {
    try {
      if (page && original) {
        await page.invoke("set_settings", { settings: original });
        await page.evaluate(
          rememberedBefore === null || rememberedBefore === undefined
            ? "localStorage.removeItem('ytmd-resume')"
            : `localStorage.setItem('ytmd-resume', ${JSON.stringify(rememberedBefore)})`,
        );
      }
    } catch (error) {
      console.error("could not put the settings back:", error.message);
    }
    page?.close();
    if (app) stop(app);
  }
  return finish();
}

process.exit(await main());
