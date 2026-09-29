/** Stage the SDK build so rebuilding the official site preserves its separately built demo subdirectory. */
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHost } from "./build-host.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = await realpath(tmpdir());
const staging = await mkdtemp(path.join(temporaryRoot, "real-frenemies-build-"));
try {
  const cli = path.join(project, "node_modules", "@rarefriends", "friendsdk", "scripts", "dev-game.mjs");
  const result = spawnSync(process.execPath, [cli, "build", "./game", "--outdir", staging], { cwd: project, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`SDK build failed (${result.status ?? result.signal}).`);
  await buildHost(staging);
  await cp(staging, path.join(project, "game", ".friendsdk"), { recursive: true });
  console.log("Built game/.friendsdk/; existing demo preserved.");
} finally {
  const resolved = await realpath(staging);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith("real-frenemies-build-")) throw new Error("Unexpected staging path; cleanup refused.");
  await rm(resolved, { recursive: true, force: true });
}
