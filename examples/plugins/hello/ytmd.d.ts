// Makes the global `ytmd` known to your editor. Put
//
//     /// <reference path="./ytmd.d.ts" />
//
// at the top of `index.js`, and `// @ts-check` if you want type errors shown.
import type { Ytmd } from "./ytmd-api";

declare global {
  const ytmd: Ytmd;
}
