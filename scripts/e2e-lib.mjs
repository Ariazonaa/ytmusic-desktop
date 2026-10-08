// Shared by the end-to-end tests: starting the built app and talking to its
// YouTube Music page over the DevTools protocol.
//
//   YTMD_EXE       the app to test, default src-tauri/target/release/ytmusic-desktop.exe
//   YTMD_E2E_PORT  DevTools port, default 9333
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const EXE = resolve(process.env.YTMD_EXE ?? "src-tauri/target/release/ytmusic-desktop.exe");
export const PORT = Number(process.env.YTMD_E2E_PORT ?? 9333);

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls `read` until it returns something truthy, and returns that. */
export async function until(what, read, timeoutMs, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** Why the test cannot start, or `null`. */
export async function preflight() {
  if (!existsSync(EXE)) return `No app at ${EXE}. Build it with "npm run tauri build -- --no-bundle" or set YTMD_EXE.`;
  if (await fetch(`http://127.0.0.1:${PORT}/json`).then(() => true, () => false)) {
    return `Something already answers on port ${PORT}. Close it or set YTMD_E2E_PORT.`;
  }
  return null;
}

/** Starts the app with its DevTools port open. `args` are passed to the app. */
export function launch(args = []) {
  return spawn(EXE, args, {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });
}

/** Ends the app at once, with the browser processes it started. */
export function stop(app) {
  if (app.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"]);
  else app.kill();
}

/**
 * Closes the app's window the way its X button does and waits for the app to
 * exit, which it only does with "minimize to tray" off. Resolves with whether it did.
 */
export async function closeWindow(app, timeoutMs = 15000) {
  if (app.exitCode !== null) return true;
  const exited = new Promise((done) => app.once("exit", () => done(true)));
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(app.pid)]);
  else app.kill("SIGTERM");
  return Promise.race([exited, sleep(timeoutMs).then(() => false)]);
}

/** Connects to the app's YouTube Music page once it exists and the app's script runs in it. */
export async function connect(app) {
  const exited = new Promise((_, fail) => {
    // A second start only brings the running app to the front and exits.
    app.once("exit", () => fail(new Error("the app exited at once; is it already running?")));
  });
  exited.catch(() => {});
  const target = await Promise.race([
    until(
      "the app's YouTube Music page",
      async () => {
        const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => null);
        return list?.find((t) => t.type === "page" && t.url.startsWith("https://music.youtube.com"));
      },
      60000,
      1000,
    ),
    exited,
  ]);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = () => fail(new Error("could not connect to the app's DevTools port"));
  });
  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    // The page asks before leaving while music plays.
    if (message.method === "Page.javascriptDialogOpening") {
      ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    }
    if (message.method === "Runtime.consoleAPICalled") {
      consoleLines.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
    pending.get(message.id)?.(message);
  };
  const send = (method, params = {}) =>
    new Promise((done) => {
      pending.set(++id, done);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression, userGesture = false) => {
    const answer = await Promise.race([
      send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture }),
      sleep(20000).then(() => null),
    ]);
    if (!answer) throw new Error(`the page did not answer: ${expression.slice(0, 60)}`);
    const { result } = answer;
    if (result.exceptionDetails) throw new Error(`in the page: ${result.exceptionDetails.exception?.description}`);
    return result.result.value;
  };
  const invoke = (command, args) =>
    evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args ?? {})})`);
  await send("Page.enable");
  await send("Runtime.enable");
  await until(
    "the app's script in the page",
    () => evaluate("Boolean(window.__TAURI_INTERNALS__ && window.__ytmDesktop?.inspect)").catch(() => false),
    40000,
  );
  return { send, evaluate, invoke, consoleLines, close: () => ws.close() };
}

/** Collects named checks and prints each as it is made. */
export function checklist() {
  const failures = [];
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
    if (!ok) failures.push(name);
  };
  const finish = () => {
    console.log(failures.length === 0 ? "\nPassed." : `\n${failures.length} failed.`);
    return failures.length === 0 ? 0 : 1;
  };
  return { check, finish };
}
