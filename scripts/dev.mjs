// Runs everything `tauri dev` needs next to the app (its `beforeDevCommand`):
//
// - a watch build of the script injected into YouTube Music
// - a watch build of the script for the plugin sandbox
// - the dev server for the settings window
//
// The app notices rebuilt scripts by itself, see `src-tauri/src/dev_inject.rs`.
import { spawn } from "node:child_process";

const tasks = [
  ["inject", ["vite", "build", "--watch"]],
  ["sandbox", ["vite", "build", "--watch", "--config", "vite.sandbox.config.ts"]],
  ["settings", ["vite", "--config", "vite.ui.config.ts"]],
];

const children = tasks.map(([name, args]) => {
  // npx is a .cmd file on Windows, which needs a shell to run.
  const child = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"], shell: true });
  const print = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim() !== "") console.log(`[${name}] ${line}`);
    }
  };
  child.stdout.on("data", print);
  child.stderr.on("data", print);
  child.on("exit", (code) => {
    // One task ending means the setup is broken: stop the others too.
    if (code !== null && code !== 0) console.error(`[${name}] exited with code ${code}`);
    stop();
  });
  return child;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
