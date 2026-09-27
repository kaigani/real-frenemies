/**
 * Build the wallet-free demo into game/.friendsdk/demo/ (run after `npm run build`, which replaces game/.friendsdk/).
 * Run: node scripts/build-demo.mjs          build only
 *      node scripts/build-demo.mjs --serve  build and serve at http://localhost:4174/
 */
import { copyFile, mkdir } from "node:fs/promises";
import { context } from "esbuild";

const outdir = "game/.friendsdk/demo";
const serve = process.argv.includes("--serve");
await mkdir(outdir, { recursive: true });
await copyFile("demo/index.html", `${outdir}/index.html`);
const ctx = await context({
  entryPoints: { demo: "demo/main.tsx" },
  outdir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: !serve,
  define: { "process.env.NODE_ENV": JSON.stringify(serve ? "development" : "production") },
  logLevel: "info",
});
if (serve) {
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 4174 });
  console.log(`Demo at http://localhost:${port}/`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
