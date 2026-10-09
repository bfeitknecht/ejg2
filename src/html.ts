import { h } from "preact";
import htm from "htm";

// htm's type definitions don't model bind(); the runtime API is stable.
// deno-lint-ignore no-explicit-any
export const html = (htm as any).bind(h);
