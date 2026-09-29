import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function buildHost(outdir) {
  const project = fileURLToPath(new URL("../", import.meta.url));
  await build({ absWorkingDir: project, entryPoints: ["host/main.tsx"], outfile: path.join(outdir, "runtime.js"),
    bundle: true, format: "iife", platform: "browser", target: "es2022", jsx: "automatic", minify: true,
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning" });
  // The SDK child document and its CSP stay intact; only the trusted parent presentation is replaced.
  await writeFile(path.join(outdir, "layout.css"), "/* Layout is supplied by the project-owned host stylesheet. */\n");
}
