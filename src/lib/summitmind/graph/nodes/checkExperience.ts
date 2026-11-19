/**
 * Node: checkExperience
 *
 * Skips cleanly when there's no signed-in user (state.userId undefined) —
 * personalization is an enhancement, not a requirement to answer at all.
 * Decide: does a missing profile mean `experience: undefined` flows through
 * silently, or does synthesize.ts need to know explicitly that no
 * personalization was possible? (It should know — otherwise you can't tell
 * "average user" from "we don't know anything about this user" downstream.)
 */

import { getExperienceProfile } from "../../tools/experience";
import type { SummitMindStateType } from "../state";

export async function checkExperience(
  state: SummitMindStateType
): Promise<Partial<SummitMindStateType>> {
  throw new Error("TODO: implement checkExperience — see comment above");
}
