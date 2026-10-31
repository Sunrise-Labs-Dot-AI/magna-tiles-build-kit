import { fork } from "node:child_process";
import path from "node:path";
import type { DesignResult } from "@/lib/planner/types";

/** Local preview only: keep long native simulations off the web server thread. */
export function experimentalDesign(input: { prompt: string; inventory: "classic-100" | "builder-xl"; unlimitedPieces: boolean }, signal: AbortSignal): Promise<DesignResult> {
  if (signal.aborted) return Promise.reject(new Error("Build check cancelled."));
  return new Promise((resolve, reject) => {
    const child = fork(path.join(process.cwd(), "scripts/experimental-design-worker.ts"), [], {
      cwd: process.cwd(), execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false, diagnostic = "";
    const finish = (error?: Error, result?: DesignResult) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", cancel);
      child.kill();
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => finish(new Error("Build check cancelled."));
    const timer = setTimeout(() => finish(new Error("The experimental check reached its time limit. No incomplete result is accepted.")), 290000);
    child.stderr?.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-1200); });
    child.once("error", error => finish(error));
    child.once("exit", code => finish(new Error(`The experimental build process stopped (${code ?? "signal"}). ${diagnostic}`)));
    child.once("message", (message: { result?: DesignResult; error?: string }) => {
      if (message.error) finish(new Error(message.error));
      else if (message.result) finish(undefined, message.result);
      else finish(new Error("The build process returned no result."));
    });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel(); else child.send(input);
  });
}
