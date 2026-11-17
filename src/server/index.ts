import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import {
  ColorRequestSchema,
  ReviewRequestSchema,
  ThermalRequestSchema,
  ThermalReportSchema,
  type ColorResponse,
  type ConfigResponse,
  type ReviewResponse,
  type ThermalResponse,
} from "../shared/schemas.ts";
import { AgentError, liveProblem, modelLabel, runColorAgent, runReviewAgent } from "./agents.ts";
import { EXAMPLES, findExample, summarize } from "./examples.ts";
import { finishReview, reviewWithRules } from "./reviewRules.ts";

const PUBLIC_DIR = path.resolve("dist/public");
const PORT = Number(process.env.PORT) || 5173;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".map": "application/json",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 20_000) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, `Invalid request: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim());
  }
  return result.data;
}

function example(id: string) {
  const found = findExample(id);
  if (!found) throw new HttpError(404, `Unknown example "${id}".`);
  return found;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, route: string): Promise<void> {
  if (req.method === "GET" && route === "/api/config") {
    const problem = await liveProblem();
    return sendJson(res, 200, { liveAvailable: !problem, liveProblem: problem, model: modelLabel() } satisfies ConfigResponse);
  }
  if (req.method === "GET" && route === "/api/examples") {
    return sendJson(res, 200, EXAMPLES.map(summarize));
  }
  if (req.method === "POST" && route === "/api/color") {
    const { exampleId, mode } = await readBody(req, ColorRequestSchema);
    const ex = example(exampleId);
    const body: ColorResponse =
      mode === "fixture"
        ? {
            report: ex.prerecordedColor,
            provenance: "prerecorded",
            provenanceLabel: "Prerecorded report. Written ahead of time from this photo, not a live model call.",
          }
        : {
            report: await runColorAgent(path.join(PUBLIC_DIR, ex.colorImage)),
            provenance: "live",
            provenanceLabel: `Color agent. Live model output (${modelLabel()}).`,
          };
    return sendJson(res, 200, body);
  }
  if (req.method === "POST" && route === "/api/thermal") {
    const { exampleId } = await readBody(req, ThermalRequestSchema);
    // Fixture lookup, validated like any other report before it leaves the server.
    const report = ThermalReportSchema.parse(example(exampleId).thermal);
    return sendJson(res, 200, { report } satisfies ThermalResponse);
  }
  if (req.method === "POST" && route === "/api/review") {
    const { mode, color, thermal } = await readBody(req, ReviewRequestSchema);
    const colorOnlyRecommendation = reviewWithRules(color, null).recommendation;
    const body: ReviewResponse =
      mode === "fixture"
        ? {
            review: reviewWithRules(color, thermal),
            producedBy: "rules",
            producedByLabel: "Review rules. Deterministic, no model involved.",
            colorOnlyRecommendation,
          }
        : {
            review: finishReview(await runReviewAgent(color, thermal), thermal),
            producedBy: "model",
            producedByLabel: `Review agent. Live model output (${modelLabel()}). The headline wording is fixed by the server.`,
            colorOnlyRecommendation,
          };
    return sendJson(res, 200, body);
  }
  throw new HttpError(404, "Not found.");
}

async function handleStatic(res: ServerResponse, route: string): Promise<void> {
  const file = path.join(PUBLIC_DIR, route === "/" ? "index.html" : route);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, "Not found.");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    throw new HttpError(404, "Not found.");
  }
}

const server = createServer((req, res) => {
  const route = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const work = route.startsWith("/api/") ? handleApi(req, res, route) : handleStatic(res, route);
  work.catch((error: unknown) => {
    if (error instanceof HttpError || error instanceof AgentError) {
      return sendJson(res, error.status, { error: error.message });
    }
    console.error(error);
    sendJson(res, 500, { error: "Unexpected server error. See the server log." });
  });
});

server.listen(PORT, () => {
  console.log(`Trail Check: http://localhost:${PORT}`);
  void liveProblem().then((problem) =>
    console.log(problem ? `Live mode not ready: ${problem} Fixture mode works.` : `Live mode ready (${modelLabel()}).`),
  );
});
