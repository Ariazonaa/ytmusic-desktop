// The lyrics window over other programs: the line being sung and the next
// one, as the lyrics plugin in the page sends them. It can be dragged
// anywhere; its close button switches the window off in the plugin's settings.
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { updatePluginSettings } from "../core/settings/client";

const line = document.getElementById("line") as HTMLElement;
const next = document.getElementById("next") as HTMLElement;
const close = document.getElementById("close") as HTMLButtonElement;

void listen<{ line: string; next: string }>("lyrics-line", ({ payload }) => {
  line.textContent = payload.line || "♪";
  next.textContent = payload.next;
});

document.querySelector("main")?.addEventListener("mousedown", (event) => {
  if (event.button === 0) void getCurrentWindow().startDragging();
});

close.addEventListener("click", () => {
  void updatePluginSettings("lyrics", { overlay: false }, false);
});
