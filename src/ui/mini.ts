// The mini player's window: what plays as the backend sends it (`mini.rs`),
// with its progress counted on between reports, and the buttons. It can be
// dragged anywhere by its background.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { clock, labels, positionNow, share, type MiniState } from "./mini-view";

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const cover = element<HTMLImageElement>("cover");
const title = element("title");
const artist = element("artist");
const progress = element("progress");
const time = element("time");
const play = element<HTMLButtonElement>("play");
const playIcon = document.getElementById("play-icon") as unknown as SVGPathElement;
const text = labels(navigator.language);
const PLAY_PATH = "M8 5v14l11-7z";
const PAUSE_PATH = "M7 5h3v14H7zm7 0h3v14h-3z";

for (const [id, label] of [
  ["previous", text.previous],
  ["next", text.next],
  ["main", text.main],
  ["close", text.close],
] as const) {
  element(id).title = label;
  element(id).setAttribute("aria-label", label);
}

let state: MiniState | null = null;

function render(): void {
  if (!state) return;
  title.textContent = state.title || text.nothing;
  artist.textContent = state.artist;
  if (state.cover) {
    if (cover.src !== state.cover) cover.src = state.cover;
    cover.hidden = false;
  } else {
    cover.hidden = true;
  }
  const label = state.paused ? text.play : text.pause;
  play.title = label;
  play.setAttribute("aria-label", label);
  playIcon.setAttribute("d", state.paused ? PLAY_PATH : PAUSE_PATH);
  tick();
}

function tick(): void {
  if (!state) return;
  const now = Date.now();
  progress.style.width = `${share(state, now) * 100}%`;
  time.textContent = state.duration !== null ? `${clock(positionNow(state, now))} / ${clock(state.duration)}` : "";
}

void listen<MiniState>("mini-state", ({ payload }) => {
  state = payload;
  render();
});
invoke<MiniState>("mini_player_state").then(
  (current) => {
    // An update may have come in meanwhile; it is newer.
    state ??= current;
    render();
  },
  () => {},
);
setInterval(tick, 500);

const control = (action: string): void => {
  void invoke("mini_player_control", { action });
};
element("previous").addEventListener("click", () => control("previous"));
play.addEventListener("click", () => control("playPause"));
element("next").addEventListener("click", () => control("next"));
element("main").addEventListener("click", () => control("main"));
element("close").addEventListener("click", () => void invoke("mini_player_close"));

document.querySelector("main")?.addEventListener("mousedown", (event) => {
  // Buttons are buttons; the rest of the window moves it.
  if (event.button === 0 && !(event.target as Element).closest("button")) void getCurrentWindow().startDragging();
});
