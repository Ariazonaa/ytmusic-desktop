// Errors of the injected script and its plugins also go to the app's log
// file, since a release build has no console anyone looks at.

/** A message and what was logged with it, as one line of text. */
export function describeLogArguments(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack?.split("\n").slice(0, 3).join(" ") ?? `${arg.name}: ${arg.message}`;
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

/**
 * A logger that behaves like the console and hands errors to `write` as well.
 * A failing `write` is ignored: logging must not cause further errors.
 */
export function fileLogger(
  write: (line: string) => Promise<void>,
  target: Pick<Console, "warn" | "error"> = console,
): Pick<Console, "warn" | "error"> {
  return {
    warn: (...args: unknown[]) => target.warn(...args),
    error: (...args: unknown[]) => {
      target.error(...args);
      try {
        write(describeLogArguments(args)).catch(() => {});
      } catch {
        // The backend is unreachable; the console has the message.
      }
    },
  };
}
