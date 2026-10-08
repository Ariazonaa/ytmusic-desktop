/// <reference path="./ytmd.d.ts" />
// Example external plugin: a "Hello" button that opens a panel with the songs
// played so far, and a notice on every song change.
//
// To try it, copy the `hello` folder into the app's plugins folder (settings
// window → "Open plugins folder"), click "Reload plugins" and switch it on.
//
// This file runs in a sandboxed iframe. It cannot see the YouTube Music page,
// your cookies or the network. Everything goes through the global `ytmd`
// object, and every call returns a promise. The panel shows this iframe's own
// document, so the plugin draws its interface with ordinary DOM calls.

const style = document.createElement("style");
style.textContent = `
  h1 { margin: 0 0 12px; font-size: 14px; font-weight: 500; color: rgba(255, 255, 255, 0.6); }
  ol { margin: 0; padding-left: 20px; }
  li { margin-bottom: 8px; }
  li::after { content: ""; display: block; clear: both; }
  img { float: right; width: 40px; height: 40px; margin-left: 8px; border-radius: 4px; object-fit: cover; }
  small { display: block; color: rgba(255, 255, 255, 0.6); }
`;
const heading = document.createElement("h1");
const list = document.createElement("ol");
document.head.append(style);
document.body.append(heading, list);

let count = 0;
function addSong(song) {
  const item = document.createElement("li");
  const artist = document.createElement("small");
  item.textContent = song.title;
  artist.textContent = song.artist;
  // With `music.read`, the panel may load covers from YouTube Music's image servers.
  if (song.artworkUrl) {
    const cover = document.createElement("img");
    cover.src = song.artworkUrl;
    cover.alt = "";
    item.prepend(cover);
  }
  item.append(artist);
  list.prepend(item);
  heading.textContent = `${++count} played this session`;
}

heading.textContent = "Nothing played yet";
const current = await ytmd.music.getCurrentSong();
if (current) addSong(current);

ytmd.on("songChange", async (song) => {
  addSong(song);
  const greeting = await ytmd.settings.get("greeting");
  await ytmd.ui.showNotice(`${greeting}: ${song.artist} – ${song.title}`);
});

let open = false;
ytmd.on("panelClose", () => (open = false));
await ytmd.ui.addNavButton("Hello", async () => {
  open = !open;
  await (open ? ytmd.ui.showPanel("Hello") : ytmd.ui.hidePanel());
});
