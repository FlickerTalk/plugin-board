// Builds `dist/` from `src/`: one bundle with Yjs, perfect-freehand and KaTeX inside, and the
// KaTeX fonts (woff2 only) beside it. The package the catalogue signs is `module.json` + `dist/`.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/fonts", { recursive: true });

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022"],
  outfile: "dist/index.js",
  loader: { ".css": "text" },
  legalComments: "none",
  logLevel: "info",
});

for (const file of readdirSync("node_modules/katex/dist/fonts")) {
  if (file.endsWith(".woff2")) copyFileSync(`node_modules/katex/dist/fonts/${file}`, `dist/fonts/${file}`);
}
