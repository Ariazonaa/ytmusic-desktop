// Compile-time check: the types handed to authors of external plugins must
// describe the API the sandbox really provides. If the two drift apart, the
// assignment below stops compiling and `npm run typecheck` fails.
import type { Ytmd } from "../../examples/plugins/hello/ytmd-api";
import type { SandboxApi } from "./protocol";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const ytmdTypesMatch: Same<Ytmd, SandboxApi> = true;
