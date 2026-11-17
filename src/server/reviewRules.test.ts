import assert from "node:assert/strict";
import { test } from "node:test";
import type { ColorReport, ThermalReport } from "../shared/schemas.ts";
import { EXAMPLES } from "./examples.ts";
import { reviewWithRules } from "./reviewRules.ts";

const [dog, bag] = EXAMPLES as [(typeof EXAMPLES)[number], (typeof EXAMPLES)[number]];
const color = (label: ColorReport["label"]): ColorReport => ({ observation: "A shape.", label, limitation: "It is dark." });
const thermal = (status: ThermalReport["status"], finding: ThermalReport["finding"]): ThermalReport => ({
  ...dog.thermal,
  status,
  finding,
});

test("dog example: warm region supports the animal reading", () => {
  const r = reviewWithRules(dog.prerecordedColor, dog.thermal);
  assert.equal(r.recommendation, "Possible animal. Review suggested.");
});

test("dog example, color only: reading stays unconfirmed", () => {
  const r = reviewWithRules(dog.prerecordedColor, null);
  assert.equal(r.recommendation, "Unconfirmed: possible animal. Color report only.");
  assert.equal(r.thermalEvidence, "not_consulted");
});

test("bag example: inconclusive thermal is reported as inconclusive", () => {
  const r = reviewWithRules(bag.prerecordedColor, bag.thermal);
  assert.equal(r.recommendation, "Possible debris. Thermal evidence inconclusive.");
});

test("unavailable thermal is not treated as an observation", () => {
  const r = reviewWithRules(color("bag_or_debris"), thermal("unavailable", "none"));
  assert.equal(r.recommendation, "Possible debris. Thermal evidence unavailable.");
  assert.notEqual(r.thermalEvidence, "no_warm_region");
});

test("observed absence of warmth is worded differently from missing evidence", () => {
  const r = reviewWithRules(color("bag_or_debris"), thermal("observed", "no_warm_region"));
  assert.equal(r.recommendation, "Possible debris. No warm region reported.");
});

test("conflicting reports give Unknown", () => {
  assert.equal(reviewWithRules(color("bag_or_debris"), thermal("observed", "warm_region")).outcome, "unknown");
  assert.equal(reviewWithRules(color("animal"), thermal("observed", "no_warm_region")).outcome, "unknown");
});

test("poor color image gives Unknown, with or without warmth", () => {
  assert.equal(reviewWithRules(color("unknown"), thermal("inconclusive", "none")).recommendation, "Unknown. Review suggested.");
  assert.equal(reviewWithRules(color("unknown"), thermal("observed", "warm_region")).outcome, "unknown");
  assert.equal(reviewWithRules(color("unknown"), null).recommendation, "Unknown. Color report only.");
});
