// Live model calls. Credentials are read from the server environment only.
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  ColorReportSchema,
  OutcomeSchema,
  ReviewDraftSchema,
  SceneLabelSchema,
  type ColorReport,
  type ReviewDraft,
  type ThermalReport,
} from "../shared/schemas.ts";

export const MODEL = process.env.TRAILCHECK_MODEL || "claude-opus-5-5";

export function liveAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** An error whose message is safe and useful to show on the page. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!liveAvailable()) {
    throw new AgentError(
      "No model credentials are configured on the server (ANTHROPIC_API_KEY). Switch on Fixture mode to use the prerecorded reports.",
      503,
    );
  }
  client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 });
  return client;
}

// Plain strings here: length limits are checked afterwards with the stricter shared schemas.
const ColorOutput = z.object({ observation: z.string(), label: SceneLabelSchema, limitation: z.string() });
const ReviewOutput = z.object({
  outcome: OutcomeSchema,
  colorContribution: z.string(),
  thermalContribution: z.string(),
  remainingUncertainty: z.string(),
});

async function ask<T extends z.ZodType>(
  step: string,
  schema: T,
  system: string,
  content: Anthropic.MessageParam["content"],
): Promise<z.infer<T>> {
  const anthropic = getClient();
  let response;
  try {
    response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: zodOutputFormat(schema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AgentError(`${step} call failed: the server's model credentials were rejected.`);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AgentError(`${step} call failed: the model is rate limited. Try again in a moment.`);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AgentError(`${step} call failed: the server could not reach the model API.`);
    }
    if (error instanceof Anthropic.APIError) {
      throw new AgentError(`${step} call failed: model API error ${error.status ?? ""} ${error.message}`.trim());
    }
    throw error;
  }
  if (response.stop_reason === "refusal") {
    throw new AgentError(`${step} call failed: the model declined to answer.`);
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError(`${step} call failed: the model did not return a complete structured answer.`);
  }
  return response.parsed_output;
}

function validated<T>(step: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AgentError(`${step} returned output that failed validation: ${result.error.issues[0]?.message ?? "invalid"}`);
  }
  return result.data;
}

const COLOR_SYSTEM = `You are the color-view step in a tool that helps a park volunteer review a trail-camera alert. A person makes the final call.

Look at the trail photo and report only what is visible in it.
- observation: one or two short plain sentences about the shape that likely triggered the alert and where it is. Example of the style: "Low shape near the center. Legs are hard to see."
- label: the single most plausible everyday scene label, or "unknown" if the photo does not support one.
- limitation: one sentence on what this photo cannot tell you.

Do not guess beyond the photo, and do not mention temperature or any other sensor.`;

export async function runColorAgent(imagePath: string): Promise<ColorReport> {
  const data = (await readFile(imagePath)).toString("base64");
  const output = await ask("Color agent", ColorOutput, COLOR_SYSTEM, [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
    { type: "text", text: "Report on this trail-camera photo." },
  ]);
  return validated("Color agent", ColorReportSchema, output);
}

const REVIEW_SYSTEM = `You are the review step in a tool that helps a park volunteer review a trail-camera alert. You receive a color report and, if one was consulted, a thermal report. You do not see the images. A person makes the final call.

Return:
- outcome: possible_animal, possible_person, possible_debris, or unknown. Use unknown when the reports conflict or do not support a useful label.
- colorContribution: one sentence on what the color report contributed.
- thermalContribution: one sentence on what the thermal report contributed.
- remainingUncertainty: one sentence on the main thing still not known.

A thermal status of "inconclusive" or "unavailable", or no thermal report at all, means no thermal evidence exists. That is different from a thermal report that observed no warm region. Never describe missing evidence as an observation, and do not let it raise or lower confidence in the color reading. Use only what the reports say.`;

export async function runReviewAgent(color: ColorReport, thermal: ThermalReport | null): Promise<ReviewDraft> {
  const reports = {
    colorReport: color,
    thermalReport: thermal
      ? {
          status: thermal.status,
          finding: thermal.finding,
          observation: thermal.observation,
          source: thermal.source,
          sceneArea: thermal.sceneArea,
        }
      : "not consulted in this run",
  };
  const output = await ask("Review agent", ReviewOutput, REVIEW_SYSTEM, JSON.stringify(reports, null, 2));
  return validated("Review agent", ReviewDraftSchema, output);
}
