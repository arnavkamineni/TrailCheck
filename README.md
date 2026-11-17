# Trail Check

A two-minute demo. A park volunteer opens a nighttime trail-camera alert, sees a color view and a
thermal view side by side, and reads a short recommendation backed by two reports. A person makes
the final call. The project covers these two staged park-camera examples and nothing else.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run dev` builds the page and starts the server with reload.
For a plain run use `npm run build` and then `npm start`.

Other commands: `npm run lint`, `npm test` (review rules), `npm run typecheck`.

## Environment variables

Copy `.env.example` to `.env`. All are optional.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables live mode. Read by the server only and never sent to the browser. |
| `TRAILCHECK_MODEL` | Model for the two live steps. Default `claude-opus-5-5`. |
| `PORT` | Default `5173`. |

Without a key the page starts with **Fixture mode** switched on. If you switch it off without a key,
the run fails with a clear message in the first card.

## What is live and what is staged

| Step | Fixture mode | Live mode |
|---|---|---|
| Color photos | Real photos, darkened by a script | Same |
| Thermal view | **Simulated** from the color photo | Same |
| 1. Color report | **Prerecorded report** | Color agent: one image call to the model |
| 2. Thermal report | **Scripted demo observation** (fixture lookup) | Same |
| 3. Review | **Review rules** (deterministic function) | Review agent: one text call to the model |

Details worth knowing before presenting:

- **No thermal sensor is involved anywhere.** `scripts/make_assets.py` paints the thermal images
  from the color photos, and the thermal observations in `src/server/examples.ts` were written by
  hand. The page says so on the pane, in the card, and in the image itself.
- **The photos are daylight photos, darkened** to imitate a low-light capture. The capture note
  on the page says so. They are not real night captures and not from a trail camera.
- **The prerecorded color reports** were written during the build by looking at the darkened
  photos. They were not produced by the app's color agent, because no model key was available.
- **The live path has not been run end to end** for the same reason. Model outputs are requested
  as structured output and validated on the server before use, and failures show in the cards.
- In live mode the model picks the outcome and writes the three sentences. The headline wording
  ("Thermal evidence inconclusive", "unavailable", "No warm region reported") is always built by
  the server from the thermal report's status, so missing evidence is never worded as an observation.
- The line "From the color report alone" under the headline always comes from the review rules.
- **Example region** rectangles are the human-drawn boxes from the Open Images annotations.
- Two examples show how the screen works. They say nothing about accuracy. Evaluating the idea
  would need time-synchronised color and thermal frames from the same camera position, with
  ground-truth labels, across many night scenes including empty frames.

## Photos

Both photos come from Open Images and are licensed CC BY 2.0. The originals are in `assets-src/`.

- Example 1: "Ready for a Romp" by Mike Lewinski, https://www.flickr.com/photos/ikewinski/8505455379
- Example 2: "Nature Walk and Coach Bag Photoshoot" by Global Good Group,
  https://www.flickr.com/photos/globalgoodgroup/8796806708

To rebuild the demo images: `python3 scripts/make_assets.py` (needs Pillow and numpy).

## Layout

- `src/shared/schemas.ts`: zod schemas for requests, reports and reviews
- `src/server/`: HTTP server, fixtures, color and review agents, review rules
- `src/web/`: the single page
