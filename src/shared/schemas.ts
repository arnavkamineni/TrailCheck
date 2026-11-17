// Shapes shared by the server and the browser. The server validates every
// request body and every model output against these before using them.
import { z } from "zod";

const text = z.string().trim().min(1).max(600);

export const ModeSchema = z.enum(["live", "fixture"]);
export type Mode = z.infer<typeof ModeSchema>;

export const SceneLabelSchema = z.enum([
  "animal",
  "person",
  "bag_or_debris",
  "vegetation_or_shadow",
  "unknown",
]);
export type SceneLabel = z.infer<typeof SceneLabelSchema>;

export const ColorReportSchema = z.object({
  observation: text,
  label: SceneLabelSchema,
  limitation: text,
});
export type ColorReport = z.infer<typeof ColorReportSchema>;

const unit = z.number().min(0).max(1);
export const RegionSchema = z.object({ x: unit, y: unit, w: unit, h: unit });
export type Region = z.infer<typeof RegionSchema>;

export const ThermalReportSchema = z
  .object({
    /** observed = the view showed something usable; the other two mean it added no evidence. */
    status: z.enum(["observed", "inconclusive", "unavailable"]),
    finding: z.enum(["warm_region", "no_warm_region", "none"]),
    observation: text,
    source: text,
    sourceDetail: text,
    sceneArea: text,
    region: RegionSchema.nullable(),
  })
  .refine((r) => (r.status === "observed") === (r.finding !== "none"), {
    message: "finding must be set exactly when status is observed",
  });
export type ThermalReport = z.infer<typeof ThermalReportSchema>;

export const OutcomeSchema = z.enum([
  "possible_animal",
  "possible_person",
  "possible_debris",
  "unknown",
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** The part of a review that a model (or the rules) writes. */
export const ReviewDraftSchema = z.object({
  outcome: OutcomeSchema,
  colorContribution: text,
  thermalContribution: text,
  remainingUncertainty: text,
});
export type ReviewDraft = z.infer<typeof ReviewDraftSchema>;

export type ThermalEvidence =
  | "warm_region"
  | "no_warm_region"
  | "inconclusive"
  | "unavailable"
  | "not_consulted";

export interface Review extends ReviewDraft {
  recommendation: string;
  thermalEvidence: ThermalEvidence;
}

export const ColorRequestSchema = z.object({ exampleId: z.string().max(40), mode: ModeSchema });
export const ThermalRequestSchema = z.object({ exampleId: z.string().max(40) });
export const ReviewRequestSchema = z.object({
  mode: ModeSchema,
  color: ColorReportSchema,
  /** null = the thermal report was not consulted (color-only run). */
  thermal: ThermalReportSchema.nullable(),
});

export interface ExampleSummary {
  id: string;
  title: string;
  captureNote: string;
  colorImage: string;
  colorImageLabel: string;
  thermalImage: string;
  thermalImageLabel: string;
  colorRegion: Region;
  thermalRegion: Region | null;
  credit: { text: string; url: string };
}

export interface ConfigResponse {
  liveAvailable: boolean;
  /** Why live mode cannot run, when it cannot. */
  liveProblem: string | null;
  model: string;
}

export interface ColorResponse {
  report: ColorReport;
  provenance: "live" | "prerecorded";
  provenanceLabel: string;
}

export interface ThermalResponse {
  report: ThermalReport;
}

export interface ReviewResponse {
  review: Review;
  producedBy: "rules" | "model";
  producedByLabel: string;
  /** What the deterministic rules say from the color report alone, for comparison. */
  colorOnlyRecommendation: string;
}
