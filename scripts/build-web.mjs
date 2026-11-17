// Bundles the browser code and copies static files into dist/public.
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/web/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/public/app.js",
  sourcemap: true,
});
await cp("src/web/index.html", "dist/public/index.html");
await cp("src/web/styles.css", "dist/public/styles.css");
await cp("public", "dist/public", { recursive: true });
console.log("web build written to dist/public");
