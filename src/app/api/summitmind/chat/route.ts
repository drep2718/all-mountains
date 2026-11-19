/**
 * POST /api/summitmind/chat
 *
 * HTTP wiring only — parses the request, invokes the compiled graph, returns
 * the response. No agent logic belongs in this file; if you find yourself
 * writing hazard reasoning here, it belongs in a node instead.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSummitMindGraph } from "@/lib/summitmind/graph";
import { startTrace } from "@/lib/summitmind/clients/langfuse";

interface ChatRequestBody {
  query: string;
  lat: number;
  lon: number;
}

export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.query || typeof body.lat !== "number" || typeof body.lon !== "number") {
    return NextResponse.json({ error: "query, lat, and lon are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const trace = startTrace("summitmind-chat", body);

  try {
    // buildSummitMindGraph() returns the already-`.compile()`d graph — build
    // once, invoke many times. `.invoke()` takes a PARTIAL initial state
    // (only the fields with no default are required — see graph/state.ts)
    // and resolves to the FULL state after every node on whichever path the
    // graph took has run and merged its update in. See graph/index.ts's
    // header comment for the full syntax walkthrough.
    const graph = buildSummitMindGraph();
    const result = await graph.invoke({
      query: body.query,
      lat: body.lat,
      lon: body.lon,
      userId: user?.id,
    });

    trace?.update({ output: result });
    return NextResponse.json({ response: result.answer, sources: result.sources, ledWithWarning: result.ledWithWarning });
  } catch (err) {
    console.error("SummitMind graph invocation failed:", err);
    trace?.update({ output: { error: String(err) } });
    return NextResponse.json({ error: "SummitMind couldn't complete that request." }, { status: 500 });
  }
}
