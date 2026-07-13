// Central IPC entry point for the frontend.
//
// Re-exports the tauri-specta generated `commands` object and all generated
// types from `src/bindings.ts`. Every component should import IPC calls and
// types from here (or directly from bindings) — never from the raw Tauri core
// invoke module (enforced by the `lint:ipc` npm script).
//
// Return convention (observed from the generated bindings):
//   - Result-typed commands resolve to `{ status: "ok"; data } | { status: "error"; error }`.
//     Wrap these in `unwrap(...)` to get the plain value (or throw on error).
//   - Bare-value commands (e.g. `greet`) resolve the plain value directly — no `unwrap`.

export * from "../bindings"; // generated types + commands

/**
 * Unwrap a tauri-specta Result. Returns the data on success, throws the error
 * value on failure. Only for commands whose generated signature is
 * `Promise<Result<T, E>>`.
 */
export function unwrap<T, E>(
  r: { status: "ok"; data: T } | { status: "error"; error: E },
): T {
  if (r.status === "error") throw r.error;
  return r.data;
}

/** Normalize any thrown/rejected IPC value into a human-readable string. */
export function formatIpcError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err)
    return String((err as { message: unknown }).message);
  return "Unknown error";
}
