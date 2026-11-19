/**
 * Node: checkCommunityReports
 *
 * The roadmap's promise, made concrete: community data is only useful here
 * if staleness and provenance stay visible, never smoothed over. Raw fetch
 * is done (tools/tripReports.ts); this node decides what to actually do
 * with what comes back.
 *
 * Worth thinking through before you write it:
 *   - A report from 6 hours ago and one from 3 weeks ago are not
 *     interchangeable evidence for "current conditions" — should stale
 *     reports be dropped, or kept but visibly marked? (Note `sources` in
 *     state carries a `retrievedAt` per item — reuse that same honesty
 *     mechanism here rather than inventing a second one.)
 *   - Zero reports for a location is a normal, common outcome for anywhere
 *     off the beaten path — it should read in the final answer as "no
 *     recent community reports for this area," not silently vanish.
 *   - This is untrusted user-generated content. It's fine — good, even —
 *     for it to inform the answer, but synthesize.ts should never treat a
 *     single trip report as equivalent evidence to an official bulletin;
 *     that weighting decision belongs here, in what you hand synthesize.ts,
 *     not left for the LLM to guess at.
 */

import { fetchNearbyTripReports } from "../../tools/tripReports";
import type { SummitMindStateType } from "../state";

export async function checkCommunityReports(
  state: SummitMindStateType
): Promise<Partial<SummitMindStateType>> {
  throw new Error("TODO: implement checkCommunityReports — see comment above");
}
