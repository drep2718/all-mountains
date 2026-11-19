/**
 * SummitMind — shared types.
 *
 * These are the shapes every node in the graph reads or writes. Defined once,
 * up front, so the graph state (graph/state.ts) and every node signature can
 * reference them instead of inlining ad-hoc shapes per file.
 */

/** A single fact the agent used to build its answer — always cite one of these, never a bare claim. */
export interface Source {
  kind: "weather" | "avalanche-bulletin" | "trip-report" | "terrain" | "experience-log";
  label: string; // human-readable, e.g. "NOAA point forecast" or "trip report by @kaylee, 2 days ago"
  url?: string;
  retrievedAt: string; // ISO timestamp — this is what lets the UI show staleness
}

export type HazardLevel = "low" | "moderate" | "considerable" | "high" | "extreme" | "unknown";

/** "unknown" is not a failure state — it's the honest answer when no bulletin covers this region. */
export interface HazardAssessment {
  level: HazardLevel;
  reasoning: string;
  sources: Source[];
}

export interface WeatherSnapshot {
  summary: string;
  tempC: { min: number; max: number };
  windKph: number;
  precipChance: number;
  source: Source;
}

export interface TrailContext {
  peakOrRouteName: string;
  elevationM: number;
  summary: string; // retrieved from Qdrant — guidebook notes, terrain description
  sources: Source[];
}

export interface ExperienceProfile {
  loggedSummits: number;
  maxElevationM: number;
  hasGlacierExperience: boolean;
  hasWinterExperience: boolean;
}

export interface CommunityTripReport {
  author: string;
  postedAt: string; // ISO — UI must show age, never hide it
  body: string;
  conditionsFlag?: "matches-current" | "possibly-stale" | "flagged";
}

/** The user-facing final answer. Every field that could contain a hazard claim must be traceable to `sources`. */
export interface SummitMindResponse {
  message: string;
  hazard: HazardAssessment;
  ledWithWarning: boolean; // true when assessRisk routed to the safety-first branch
  sources: Source[];
}
