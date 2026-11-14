// The simulator's Web Worker: runs a comparison off the main thread so the page stays responsive,
// reporting progress as it goes. Messages: { id, mode, inputs, params } in; { id, type: "progress",
// done, total }, then { id, type: "result", result } or { id, type: "error", message } out.

import { runComparison, type SimMode } from "./runner";
import type { SimInputs, SimParams } from "./types";

type Request = { id: number; mode: SimMode; inputs: SimInputs; params: SimParams };

const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: unknown) => void };

scope.onmessage = (event) => {
  const { id, mode, inputs, params } = event.data;
  try {
    const result = runComparison(inputs, mode, params, (done, total) => scope.postMessage({ id, type: "progress", done, total }));
    scope.postMessage({ id, type: "result", result });
  } catch (error) {
    scope.postMessage({ id, type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
