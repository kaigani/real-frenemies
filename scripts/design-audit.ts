/** Reproducible design-review probes; no changes to game rules or saved state.
 * Run: node scripts/design-audit.ts
 * Some probes deliberately construct fixture states; they are labelled below.
 */
import { POOL } from "../game/src/friends.ts";
import { Session } from "../game/src/session.ts";
import { formatRf, rf } from "../game/src/economy.ts";
import { buildable } from "../game/src/terrain.ts";

const player = POOL.find(f => f.tokenId === 7730n)!;
const fresh = () => new Session(player, POOL, rf(500), 0);
function fill(s: Session, id: string, count = 3) { // supply cap: 3 x L4 = 12
  const held = s.heldById(id)!;
  const friends = [...s.pool].filter(f => !s.isPlaced(f))
    .sort((a, b) => a.generation - b.generation || b.activationTier - a.activationTier);
  const spots: { x: number; y: number }[] = [];
  for (let y = 0; y < 8; y++) for (let x = 3; x < 12; x++) {
    if (buildable(held.region.board, x, y)) spots.push({ x, y });
  }
  spots.sort((a, b) => Math.max(Math.abs(a.x - 9), Math.abs(a.y - 4)) - Math.max(Math.abs(b.x - 9), Math.abs(b.y - 4)));
  for (let i = 0; i < count; i++) {
    const p = s.place(held, friends[i], spots[i].x, spots[i].y);
    while (p.level < 4) s.levelUp(p.key);
  }
}

const maxed = fresh();
fill(maxed, maxed.held()[0].id);
while (maxed.coreLevel < 4) maxed.levelUpCore();
console.log("Day-one full L4 home:", { day: maxed.day, pieces: maxed.pieces().length, core: maxed.coreLevel, spent: formatRf(rf(500) - maxed.ledger.balance) });

for (const location of ["home", "expansion"] as const) {
  const s = fresh();
  s.expand(1, 0);
  fill(s, s.held().find(h => h.region.home === (location === "home"))!.id);
  const incoming = s.incoming()!;
  console.log("Same three L4 defenders placed in", location, { incoming: incoming.party.length, rival: incoming.rival.difficulty, levels: incoming.party.map(p => p.level) });
}

console.log("Duplicate attacker keys accepted:", maxed.raidError(Array(4).fill(maxed.pieces()[0].key)) === null);

let resetProbe = false;
for (const f of POOL) {
  const s = new Session(f, POOL, rf(500), 0);
  const report = s.endDay();
  if (report.records.some(r => r.kind === "defense" && r.reset)) {
    console.log("Immediately after a real nightly Core reset:", { token: String(f.tokenId), day: s.day, core: s.coreLevel,  protected: s.isProtected("you"), anotherRaidAvailable: s.incoming() !== null });
    resetProbe = true;
    break;
  }
}
if (!resetProbe) console.log("No reset found in empty-home fixture sweep.");

const reclaim = fresh();
const region = reclaim.expand(1, 0);
region.holder = reclaim.rivals[0].id; // Fixture: enemy resident with an empty garrison.
fill(reclaim, reclaim.held()[0].id, 1);
const eviction = reclaim.reclaimRaid(region.key, [reclaim.pieces()[0].key], 1);
console.log("Empty enemy-held reclaim fixture:", { won: eviction.campaign.won, refundedToRaider: formatRf(eviction.settlement.toYou), net: formatRf(eviction.net), feeLines: eviction.settlement.lines.filter(l => l.label.includes("80%")).map(l => ({ label: l.label, amount: formatRf(l.amount), to: l.to })) });

const claims = new Session(player, POOL, rf(2000), 0);
claims.wonToday = 2; // Fixture: a win over Hard, which owns two expanded regions.
const claimKeys = claims.claimable(2).map(r => r.key);
for (const key of claimKeys) { try { claims.claim(2, key); } catch (e) { console.log("  second claim rejected:", (e as Error).message); } }
console.log("One-win claim fixture:", { claims: claimKeys.length, heldOutposts: claims.held().filter(h => h.rival).length });

// Extend the repository's existing bot unchanged except duration to eight rounds.
// Dynamic import preserves its relative imports; its heading says 14 days but its loop is 13.
const { readFile, writeFile, unlink, mkdir } = await import("node:fs/promises");
const source = await readFile(new URL("./session-bot.ts", import.meta.url), "utf8");
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
const temporary = new URL("../artifacts/design-audit-56-days.ts", import.meta.url);
await writeFile(temporary, source.replace("day <= 13", "day <= 56"));
console.log("56-day existing-bot runs (same policy; different token seeds are confounded):");
try { await import(temporary.href); } finally { await unlink(temporary); }
