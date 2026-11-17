// Live model calls: Claude over the API, or an open model on this machine through Ollama.
// Credentials are read from the server environment only.
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

type Provider = "anthropic" | "ollama";

const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** TRAILCHECK_PROVIDER wins. Otherwise: Claude if a key is set, else a local model through Ollama. */
function provider(): Provider {
  const chosen = process.env.TRAILCHECK_PROVIDER?.toLowerCase();
  if (chosen === "anthropic" || chosen === "ollama") return chosen;
  return hasAnthropicKey() ? "anthropic" : "ollama";
}

const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";
const ANTHROPIC_MODEL = process.env.TRAILCHECK_MODEL || "claude-opus-5-5";

/** Shown on the page next to live outputs. */
export function modelLabel(): string {
  return provider() === "ollama" ? `${OLLAMA_MODEL}, running locally through Ollama` : ANTHROPIC_MODEL;
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

const FIXTURE_HINT = "Switch on Fixture mode to use the prerecorded reports.";

/** Returns null when live mode can run, otherwise a sentence saying what is missing. */
export async function liveProblem(): Promise<string | null> {
  if (provider() === "anthropic") {
    return hasAnthropicKey() ? null : "No model credentials are configured on the server (ANTHROPIC_API_KEY).";
  }
  let tags: { models?: { name?: string }[] };
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return `Ollama at ${OLLAMA_HOST} answered with status ${res.status}.`;
    tags = (await res.json()) as typeof tags;
  } catch {
    return `Ollama is not running at ${OLLAMA_HOST}. Start the Ollama app, or run "ollama serve".`;
  }
  const names = (tags.models ?? []).map((m) => m.name ?? "");
  const wanted = OLLAMA_MODEL.includes(":") ? OLLAMA_MODEL : `${OLLAMA_MODEL}:latest`;
  return names.includes(wanted) ? null : `The local model is not downloaded. Run "ollama pull ${OLLAMA_MODEL}".`;
}

// Plain strings here: length limits are checked afterwards with the stricter shared schemas.
const ColorOutput = z.object({ observation: z.string(), label: SceneLabelSchema, limitation: z.string() });
const ReviewOutput = z.object({
  outcome: OutcomeSchema,
  colorContribution: z.string(),
  thermalContribution: z.string(),
  remainingUncertainty: z.string(),
});

interface Prompt {
  system: string;
  text: string;
  /** Base64 JPEG. */
  image?: string;
}

let client: Anthropic | undefined;

async function askAnthropic<T extends z.ZodType>(step: string, schema: T, prompt: Prompt): Promise<z.infer<T>> {
  client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 });
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: prompt.text }];
  if (prompt.image) {
    content.unshift({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: prompt.image } });
  }
  let response;
  try {
    response = await client.messages.parse({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: prompt.system,
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

/** Local model through Ollama's chat endpoint, constrained to the schema with its `format` option. */
async function askOllama(step: string, schema: z.ZodType, prompt: Prompt): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: z.toJSONSchema(schema),
        options: { temperature: 0 },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.text, ...(prompt.image ? { images: [prompt.image] } : {}) },
        ],
      }),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AgentError(
      timedOut
        ? `${step} call failed: the local model took longer than three minutes.`
        : `${step} call failed: could not reach Ollama at ${OLLAMA_HOST}. Is it running?`,
    );
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: { content?: string } } | null;
  if (!res.ok) {
    throw new AgentError(
      res.status === 404
        ? `${step} call failed: the local model is not downloaded. Run "ollama pull ${OLLAMA_MODEL}".`
        : `${step} call failed: Ollama error ${res.status} ${body?.error ?? ""}`.trim(),
    );
  }
  try {
    return JSON.parse(body?.message?.content ?? "");
  } catch {
    throw new AgentError(`${step} call failed: the local model did not return valid JSON.`);
  }
}

async function ask<T extends z.ZodType>(step: string, schema: T, prompt: Prompt): Promise<unknown> {
  const problem = await liveProblem();
  if (problem) throw new AgentError(`${problem} ${FIXTURE_HINT}`, 503);
  return provider() === "ollama" ? askOllama(step, schema, prompt) : askAnthropic(step, schema, prompt);
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
  const output = await ask("Color agent", ColorOutput, {
    system: COLOR_SYSTEM,
    text: "Report on this trail-camera photo.",
    image: data,
  });
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
  const output = await ask("Review agent", ReviewOutput, { system: REVIEW_SYSTEM, text: JSON.stringify(reports, null, 2) });
  return validated("Review agent", ReviewDraftSchema, output);
}
