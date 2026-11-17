// The two staged examples. Everything in this file is fixture data.
import type { ColorReport, ExampleSummary, ThermalReport } from "../shared/schemas.ts";

interface Example extends ExampleSummary {
  /** Used in fixture mode instead of a live color-agent call. */
  prerecordedColor: ColorReport;
  thermal: ThermalReport;
}

const THERMAL_SOURCE = "Scripted demo observation";
const THERMAL_SOURCE_DETAIL =
  "Written by hand for this demo. The thermal view is simulated from the color photo. No thermal camera or detector produced it.";
const CAPTURE_NOTE = "Low light (simulated: a daylight photo darkened for the demo).";

export const EXAMPLES: Example[] = [
  {
    id: "dog",
    title: "Example 1: shape by the gate",
    captureNote: CAPTURE_NOTE,
    colorImage: "/images/dog-color.jpg",
    colorImageLabel: "Color view",
    thermalImage: "/images/dog-thermal.jpg",
    thermalImageLabel: "Simulated thermal view",
    colorRegion: { x: 0.365, y: 0.162, w: 0.256, h: 0.654 },
    thermalRegion: { x: 0.365, y: 0.162, w: 0.256, h: 0.654 },
    credit: {
      text: "“Ready for a Romp” by Mike Lewinski, CC BY 2.0, via Open Images. Darkened.",
      url: "https://www.flickr.com/photos/ikewinski/8505455379",
    },
    prerecordedColor: {
      observation:
        "Dark, low shape near the center of the path, in front of a wire gate. It looks four-legged with its front end lowered toward the ground.",
      label: "animal",
      limitation:
        "The outline blends into the dark ground and the legs are faint, so the shape could also be a stump or a shadow.",
    },
    thermal: {
      status: "observed",
      finding: "warm_region",
      observation:
        "Warm region near the center of the frame, in the same place as the shape in the color photo. It is low to the ground.",
      source: THERMAL_SOURCE,
      sourceDetail: THERMAL_SOURCE_DETAIL,
      sceneArea: "Center of the frame, on the path in front of the gate.",
      region: { x: 0.365, y: 0.162, w: 0.256, h: 0.654 },
    },
  },
  {
    id: "bag",
    title: "Example 2: object on the rock",
    captureNote: CAPTURE_NOTE,
    colorImage: "/images/bag-color.jpg",
    colorImageLabel: "Color view",
    thermalImage: "/images/bag-thermal.jpg",
    thermalImageLabel: "Simulated thermal view",
    colorRegion: { x: 0.496, y: 0.308, w: 0.258, h: 0.443 },
    thermalRegion: null,
    credit: {
      text: "“Nature Walk and Coach Bag Photoshoot” by Global Good Group, CC BY 2.0, via Open Images. Cropped and darkened.",
      url: "https://www.flickr.com/photos/globalgoodgroup/8796806708",
    },
    prerecordedColor: {
      observation:
        "Backpack-shaped object resting on a rock ledge beside the trail, with a zipper down the front. Trees behind it. No person is visible.",
      label: "bag_or_debris",
      limitation:
        "The photo cannot show whether the owner is nearby outside the frame or how long the object has been there.",
    },
    thermal: {
      status: "inconclusive",
      finding: "none",
      observation:
        "The frame is low contrast and no region stands out from the background, so it does not show whether the object is warm or cold.",
      source: THERMAL_SOURCE,
      sourceDetail: THERMAL_SOURCE_DETAIL,
      sceneArea: "Whole frame. No specific region.",
      region: null,
    },
  },
];

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export function summarize(e: Example): ExampleSummary {
  const summary: Partial<Example> = { ...e };
  delete summary.prerecordedColor;
  delete summary.thermal;
  return summary as ExampleSummary;
}
