// Deterministic review. Shown in the UI as "Review rules".
import type {
  ColorReport,
  Outcome,
  Review,
  ReviewDraft,
  SceneLabel,
  ThermalEvidence,
  ThermalReport,
} from "../shared/schemas.ts";

const OUTCOME_FROM_COLOR: Record<SceneLabel, Outcome> = {
  animal: "possible_animal",
  person: "possible_person",
  bag_or_debris: "possible_debris",
  vegetation_or_shadow: "unknown",
  unknown: "unknown",
};

const OUTCOME_TEXT: Record<Outcome, string> = {
  possible_animal: "Possible animal",
  possible_person: "Possible person",
  possible_debris: "Possible debris",
  unknown: "Unknown",
};

const LABEL_TEXT: Record<SceneLabel, string> = {
  animal: "an animal",
  person: "a person",
  bag_or_debris: "a bag or debris",
  vegetation_or_shadow: "vegetation or a shadow",
  unknown: "something it could not name",
};

/** Keeps "nothing was observed" separate from "something was observed". */
export function thermalEvidence(thermal: ThermalReport | null): ThermalEvidence {
  if (!thermal) return "not_consulted";
  if (thermal.status !== "observed") return thermal.status;
  return thermal.finding === "warm_region" ? "warm_region" : "no_warm_region";
}

/** The headline is always built here, so a model cannot blur the evidence wording. */
export function recommendationText(outcome: Outcome, evidence: ThermalEvidence): string {
  const base = OUTCOME_TEXT[outcome];
  if (evidence === "not_consulted") {
    return outcome === "unknown"
      ? "Unknown. Color report only."
      : `Unconfirmed: ${base.toLowerCase()}. Color report only.`;
  }
  if (outcome === "unknown" || evidence === "warm_region") return `${base}. Review suggested.`;
  if (evidence === "no_warm_region") return `${base}. No warm region reported.`;
  return `${base}. Thermal evidence ${evidence}.`;
}

export function finishReview(draft: ReviewDraft, thermal: ThermalReport | null): Review {
  const evidence = thermalEvidence(thermal);
  return { ...draft, recommendation: recommendationText(draft.outcome, evidence), thermalEvidence: evidence };
}

function decideOutcome(label: SceneLabel, evidence: ThermalEvidence): { outcome: Outcome; conflict: boolean } {
  const fromColor = OUTCOME_FROM_COLOR[label];
  if (evidence === "warm_region") {
    // A warm region supports a living thing. It cannot name one on its own.
    if (label === "animal" || label === "person") return { outcome: fromColor, conflict: false };
    return { outcome: "unknown", conflict: label !== "unknown" };
  }
  if (evidence === "no_warm_region") {
    if (label === "animal" || label === "person") return { outcome: "unknown", conflict: true };
    return { outcome: fromColor, conflict: false };
  }
  return { outcome: fromColor, conflict: false };
}

/** Makes a full sentence usable as the tail of another one. */
const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, "");
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
};

export function reviewWithRules(color: ColorReport, thermal: ThermalReport | null): Review {
  const evidence = thermalEvidence(thermal);
  const { outcome, conflict } = decideOutcome(color.label, evidence);

  const colorContribution = `The color report read the shape as ${LABEL_TEXT[color.label]}, with this limit: ${sentence(color.limitation)}.`;

  const thermalContribution = {
    warm_region: conflict
      ? "The thermal report noted a warm region there, which does not fit the color reading."
      : color.label === "unknown"
        ? "The thermal report noted a warm region there, which points to something alive but does not say what."
        : "The thermal report noted a warm region in the same place, which fits a living thing better than an object or a shadow.",
    no_warm_region: conflict
      ? "The thermal report noted no warm region there, which does not fit the color reading."
      : "The thermal report noted no warm region there, which fits an object rather than a living thing.",
    inconclusive: "The thermal report was inconclusive, so it neither supports nor contradicts the color reading.",
    unavailable: "No thermal observation was available, so nothing was added to the color reading.",
    not_consulted: "The thermal report was not consulted in this run.",
  }[evidence];

  let remainingUncertainty: string;
  if (conflict) {
    remainingUncertainty = "The two reports disagree, so neither reading is supported until a person checks the scene.";
  } else if (outcome === "unknown") {
    remainingUncertainty = "The reports do not support a useful label for what is on the trail.";
  } else if (evidence === "warm_region") {
    remainingUncertainty = "Neither report identifies the kind of animal or person, or whether it is still there.";
  } else if (evidence === "no_warm_region") {
    remainingUncertainty = "A recently placed or sun-warmed object could look different, and neither report says what the object is.";
  } else {
    remainingUncertainty = `Without thermal evidence the label rests on the color photo alone: ${sentence(color.limitation)}.`;
  }

  return finishReview({ outcome, colorContribution, thermalContribution, remainingUncertainty }, thermal);
}
