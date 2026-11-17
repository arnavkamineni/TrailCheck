import type {
  ColorResponse,
  ConfigResponse,
  ExampleSummary,
  Mode,
  Region,
  ReviewResponse,
  ThermalResponse,
} from "../shared/schemas.ts";

type Step<T> =
  | { state: "idle" }
  | { state: "running" }
  | { state: "skipped" }
  | { state: "done"; data: T }
  | { state: "error"; message: string };

const SCENE_LABEL: Record<ColorResponse["report"]["label"], string> = {
  animal: "Animal",
  person: "Person",
  bag_or_debris: "Bag or debris",
  vegetation_or_shadow: "Vegetation or shadow",
  unknown: "Unknown",
};
const THERMAL_STATUS: Record<ThermalResponse["report"]["status"], string> = {
  observed: "Evidence observed",
  inconclusive: "Inconclusive. No evidence either way.",
  unavailable: "Unavailable. No thermal evidence.",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

let config: ConfigResponse = { liveAvailable: false, model: "" };
let examples: ExampleSummary[] = [];
let selected = "";
let running = false;
let color: Step<ColorResponse> = { state: "idle" };
let thermal: Step<ThermalResponse> = { state: "idle" };
let review: Step<ReviewResponse> = { state: "idle" };
/** Reuses a color report within one example and mode, so a rerun with thermal compares like with like. */
const colorCache = new Map<string, ColorResponse>();

const fixtureToggle = $<HTMLInputElement>("fixture-mode");
const colorOnlyToggle = $<HTMLInputElement>("color-only");
const regionToggle = $<HTMLInputElement>("show-region");
const mode = (): Mode => (fixtureToggle.checked ? "fixture" : "live");
const current = () => examples.find((e) => e.id === selected)!;

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, body === undefined ? undefined : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the Trail Check server.");
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status}).`);
  return json as T;
}

function placeRegion(node: HTMLElement, region: Region | null) {
  node.hidden = !regionToggle.checked || !region;
  if (!region) return;
  Object.assign(node.style, {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.w * 100}%`,
    height: `${region.h * 100}%`,
  });
}

function renderScene() {
  const ex = current();
  for (const tab of $("tabs").querySelectorAll("button")) {
    tab.setAttribute("aria-selected", String(tab.dataset.id === selected));
  }
  $<HTMLImageElement>("color-img").src = ex.colorImage;
  $<HTMLImageElement>("thermal-img").src = ex.thermalImage;
  $("color-label").textContent = ex.colorImageLabel;
  $("thermal-label").textContent = ex.thermalImageLabel;
  $("capture-note").textContent = ex.captureNote;
  const credit = $("credit");
  credit.replaceChildren("Photo: ");
  const link = el("a", "", ex.credit.text) as HTMLAnchorElement;
  link.href = ex.credit.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  credit.append(link);
  $("thermal-cover").hidden = !colorOnlyToggle.checked;
  placeRegion($("color-region"), ex.colorRegion);
  placeRegion($("thermal-region"), colorOnlyToggle.checked ? null : ex.thermalRegion);
}

function renderModeNote() {
  const note = $("mode-note");
  note.replaceChildren();
  if (mode() === "fixture") {
    note.append(el("strong", "", "Fixture mode. "), "Color reports are prerecorded and the review is done by fixed rules. No model is called.");
  } else if (config.liveAvailable) {
    note.append(el("strong", "", "Live mode. "), `The color agent and the review agent call ${config.model}. The thermal report is still a scripted demo observation.`);
  } else {
    note.append(el("strong", "", "Live mode, but no model credentials are configured on the server. "), "Runs will fail until a key is set. Switch on Fixture mode to use the prerecorded reports.");
  }
}

function card<T>(id: string, title: string, step: Step<T>, idleText: string, fill: (body: HTMLElement, data: T) => void) {
  const node = $(id);
  node.className = `card ${step.state}`;
  const heading = el("h2");
  const stateText = { idle: "Waiting", running: "Working", skipped: "Skipped", done: "Done", error: "Failed" }[step.state];
  heading.append(el("span", "", title), el("span", "state", stateText));
  node.replaceChildren(heading);
  if (step.state === "done") fill(node, step.data);
  else if (step.state === "error") node.append(el("p", "errmsg", step.message));
  else node.append(el("p", "placeholder", step.state === "skipped" ? "Not consulted. This run uses the color report only." : idleText));
}

function rows(body: HTMLElement, items: [string, string][]) {
  const dl = el("dl");
  for (const [term, value] of items) dl.append(el("dt", "", term), el("dd", "", value));
  body.append(dl);
}

function renderCards() {
  card("card-color", "1. Color report", color, "Describes what the color photo shows.", (body, data) => {
    body.append(el("span", `badge ${data.provenance === "live" ? "live" : "staged"}`, data.provenanceLabel));
    rows(body, [
      ["Observation", data.report.observation],
      ["Scene label", SCENE_LABEL[data.report.label]],
      ["Limitation", data.report.limitation],
    ]);
  });
  card("card-thermal", "2. Thermal report", thermal, "Loads the thermal observation supplied for this example.", (body, data) => {
    body.append(el("span", "badge staged", `${data.report.source}. ${data.report.sourceDetail}`));
    rows(body, [
      ["Status", THERMAL_STATUS[data.report.status]],
      ["Observation", data.report.observation],
      ["Refers to", data.report.sceneArea],
    ]);
  });
  card("card-review", "3. Review", review, "Combines the reports into one recommendation.", (body, data) => {
    body.append(el("span", `badge ${data.producedBy === "model" ? "live" : "staged"}`, data.producedByLabel));
    rows(body, [
      ["Color view contributed", data.review.colorContribution],
      ["Thermal view contributed", data.review.thermalContribution],
      ["Still uncertain", data.review.remainingUncertainty],
    ]);
  });
}

function renderHeadline() {
  const node = $("headline");
  node.replaceChildren(el("div", "eyebrow", "Recommendation"));
  const failure = [color, thermal, review].find((s) => s.state === "error");
  if (review.state === "done") {
    const { review: r, colorOnlyRecommendation } = review.data;
    node.className = `headline done ${r.outcome === "unknown" ? "unknown" : ""}`;
    node.append(el("p", "rec", r.recommendation));
    if (r.thermalEvidence !== "not_consulted") {
      node.append(el("p", "compare", `From the color report alone (Review rules): ${colorOnlyRecommendation}`));
    }
  } else if (failure?.state === "error") {
    node.className = "headline error";
    node.append(el("p", "rec pending", "No recommendation. A step failed, see the card below."));
  } else {
    node.className = "headline";
    node.append(el("p", "rec pending", running ? "Reviewing…" : "Not reviewed yet. Press “Review alert”."));
  }
}

function render() {
  renderScene();
  renderModeNote();
  renderCards();
  renderHeadline();
  $<HTMLButtonElement>("run").disabled = running;
  fixtureToggle.disabled = colorOnlyToggle.disabled = running;
}

function reset() {
  color = thermal = review = { state: "idle" };
  render();
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt<T>(set: (step: Step<T>) => void, work: () => Promise<T>): Promise<T | null> {
  set({ state: "running" });
  render();
  try {
    const data = await work();
    set({ state: "done", data });
    return data;
  } catch (error) {
    set({ state: "error", message: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    render();
  }
}

async function run() {
  if (running) return;
  const exampleId = selected;
  const runMode = mode();
  const colorOnly = colorOnlyToggle.checked;
  running = true;
  color = review = { state: "idle" };
  thermal = colorOnly ? { state: "skipped" } : { state: "idle" };
  try {
    const cacheKey = `${exampleId}:${runMode}`;
    const colorData = await attempt<ColorResponse>((s) => (color = s), async () => {
      const cached = colorCache.get(cacheKey);
      if (cached) return cached;
      // Fixture lookups are instant, so a short pause keeps the step visible.
      if (runMode === "fixture") await pause(450);
      const fresh = await api<ColorResponse>("/api/color", { exampleId, mode: runMode });
      colorCache.set(cacheKey, fresh);
      return fresh;
    });
    if (!colorData) return;

    let thermalData: ThermalResponse | null = null;
    if (!colorOnly) {
      thermalData = await attempt<ThermalResponse>((s) => (thermal = s), async () => {
        await pause(450);
        return api<ThermalResponse>("/api/thermal", { exampleId });
      });
      if (!thermalData) return;
    }

    await attempt<ReviewResponse>((s) => (review = s), async () => {
      if (runMode === "fixture") await pause(450);
      return api<ReviewResponse>("/api/review", {
        mode: runMode,
        color: colorData.report,
        thermal: thermalData?.report ?? null,
      });
    });
  } finally {
    running = false;
    render();
  }
}

async function start() {
  [config, examples] = await Promise.all([api<ConfigResponse>("/api/config"), api<ExampleSummary[]>("/api/examples")]);
  selected = examples[0]!.id;
  fixtureToggle.checked = !config.liveAvailable;
  for (const ex of examples) {
    const tab = el("button", "", ex.title) as HTMLButtonElement;
    tab.type = "button";
    tab.dataset.id = ex.id;
    tab.addEventListener("click", () => {
      if (running) return;
      selected = ex.id;
      reset();
    });
    $("tabs").append(tab);
  }
  fixtureToggle.addEventListener("change", () => !running && reset());
  colorOnlyToggle.addEventListener("change", () => !running && render());
  regionToggle.addEventListener("change", render);
  $("run").addEventListener("click", run);
  render();
}

start().catch((error: unknown) => {
  $("headline").textContent = `Trail Check could not start: ${error instanceof Error ? error.message : String(error)}`;
});
