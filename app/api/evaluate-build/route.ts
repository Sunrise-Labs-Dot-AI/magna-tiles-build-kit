import { validateContract } from "@/lib/harness/contract";
import { evaluateCandidate } from "@/lib/harness/evaluate";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
export const runtime = "nodejs";
export const maxDuration = 300;
/** Agent tool: submit any construction against the unchanged intent contract. */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 1000000)
      return Response.json(
        { error: "Candidate request too large." },
        { status: 413 },
      );
    const body = JSON.parse(text);
    validateContract(body?.contract);
    return Response.json(
      await evaluateCandidate(body?.build, body.contract, {
        deadline: Date.now() + 240000,
      }),
    );
  } catch (error) {
    if (error instanceof SimulationBudgetExceeded)
      return Response.json(
        { status: "budget-exhausted", error: error.message },
        { status: 503 },
      );
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid candidate." },
      { status: 400 },
    );
  }
}
