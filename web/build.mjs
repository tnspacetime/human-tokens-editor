// Bundles the renderer into one self-contained HTML file the app ships with.
// Run `npm run build` after changing anything in web/src.
import * as esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const js = await esbuild.build({
  entryPoints: ["src/renderer.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "safari17",
  write: false,
});

const css = await esbuild.build({
  entryPoints: ["src/renderer.css"],
  bundle: true,
  minify: true,
  write: false,
  // KaTeX lists woff2 first; WebKit never needs the woff/ttf fallbacks.
  loader: { ".woff2": "dataurl", ".woff": "empty", ".ttf": "empty" },
});

const template = await readFile("src/template.html", "utf8");
const html = template
  .replace("/*__CSS__*/", () => css.outputFiles[0].text)
  .replace("/*__JS__*/", () => js.outputFiles[0].text.replaceAll("</script", "<\\/script"));

await writeFile("../Surface/renderer.html", html);
console.log(`Surface/renderer.html  ${(html.length / 1024).toFixed(0)} KB`);
