import { api } from "./api";

/** Sends a crash report to the backend log (`railway logs` in production). Never throws. */
export function reportClientError(error: unknown, component = "") {
  const e = error instanceof Error ? error : new Error(String(error));
  api
    .post("/client-errors", { message: e.message, stack: e.stack, component, url: window.location.href })
    .catch(() => undefined);
}
