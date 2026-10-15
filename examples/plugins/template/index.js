/// <reference path="./ytmd.d.ts" />
// @ts-check
// A starting point for a plugin of your own. To use it:
//
// 1. Copy this folder into the app's plugins folder (settings window →
//    "Open plugins folder") and rename it, say to `lyrics-to-file`.
// 2. Put the same name into `plugin.json` as `name`, and write a description.
// 3. Click "Reload plugins" in the settings window and switch it on.
//
// The guide is docs/plugins.md in the app's repository. In short: this file
// runs in a sandbox, sees neither the page nor the network, and does
// everything through the global `ytmd`, whose calls all return promises.
// `plugin.json` lists the permissions a call needs; ask for no more than you
// use, the settings window shows them to the user.

ytmd.on("songChange", async (song) => {
  if ((await ytmd.settings.get("showNotice")) !== true) return;
  await ytmd.ui.showNotice(`${song.artist} – ${song.title}`);
});
