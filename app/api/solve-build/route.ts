import { parseIntent, validateContract } from "@/lib/harness/contract";
import { solveContract } from "@/lib/harness/solve";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 16000)
      return Response.json(
        { error: "Contract request too large." },
        { status: 413 },
      );
    const body = JSON.parse(text);
    if (
      body?.unlimitedPieces !== undefined &&
      typeof body.unlimitedPieces !== "boolean"
    )
      throw new Error("unlimitedPieces must be boolean.");
    const contract =
      body?.contract ??
      parseIntent(
        body?.prompt,
        body?.inventoryPreset === "builder-xl" ? "builder-xl" : "classic-100",
        body?.unlimitedPieces === true,
      );
    if (!contract)
      return Response.json({
        status: "unsupported",
        explanation:
          "The constructive grammar currently supports towers, open containers, tunnels and staircases.",
      });
    validateContract(contract);
    return Response.json(await solveContract(contract));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 },
    );
  }
}
