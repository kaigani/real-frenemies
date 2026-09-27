/** 13-day sessions with a simple bot for several player Friends: builds, expands, raids, claims. Run: node scripts/session-bot.ts */
import { formatRf, rf } from "../game/src/economy.ts";
import { POOL } from "../game/src/friends.ts";
import { createRng } from "../game/src/rng.ts";
import { EXPAND_COST } from "../game/src/rules.ts";
import { Session } from "../game/src/session.ts";
import { buildable, } from "../game/src/terrain.ts";

for (const player of POOL.filter((_, i) => i % 8 === 0)) {
  const s = new Session(player, POOL, rf(500), 0);
  const rng = createRng(Number(player.tokenId));
  let raidsWon = 0, held = 0, resets = 0, claims = 0, evictions = 0, firstRound = "";
  const log: string[] = [];
  for (let day = 1; day <= 13; day++) {
    if (!s.coreLevel) { if (s.broke) { log.push("BROKE"); break; } if (!s.isProtected("you") || s.ledger.balance >= rf(1)) s.activateCore(); }
    // Expand once affordable (keep 60 RF for pieces and fees), then fill every held region and level up.
    if (s.ledger.balance >= rf(EXPAND_COST + 60) && s.expandOptions().length && s.territory.regions.length < 3) { const o = s.expandOptions()[0]; s.expand(o.dx, o.dy); }
    for (const h of s.held()) {
      for (let tries = 0; h.region.garrison.length < 4 && s.ledger.balance >= rf(8) && tries < 60; tries++) {
        const f = s.pool[rng.int(s.pool.length)];
        const x = h.region.board.core.x - 1 - rng.int(4), y = Math.max(0, Math.min(7, h.region.board.core.y - 2 + rng.int(5)));
        if (!s.isPlaced(f) && buildable(h.region.board, x, y) && !h.region.garrison.some(p => p.x === x && p.y === y)) s.place(h, f, x, y);
      }
    }
    for (const p of [...s.pieces()].sort((a, b) => a.level - b.level)) {
      const cost = s.levelCost(p.level);
      if (cost !== null && !s.levelUpError(p.key) && s.ledger.balance - cost >= rf(8)) s.levelUp(p.key);
    }
    // Reclaim any dropped flag at home; raid the rival nearest our strength.
    for (const r of s.territory.regions) if (!r.home && r.holder === null && s.ledger.balance >= rf(260)) s.reclaim(r.key);
    const party = [...s.pieces()].sort((a, b) => b.level - a.level).slice(0, 4).map(p => p.key);
    const avg = party.reduce((n, k) => n + s.piece(k)!.level, 0) / Math.max(1, party.length);
    const preferred = avg >= 3.5 ? 2 : avg >= 2.5 ? 1 : 0;
    const target = [preferred, 1, 0, 2].find(i => !s.isProtected(s.rivals[i].id)) ?? -1;
    if (party.length && target >= 0 && !s.raidError(party, "raid", target)) {
      const r = s.raid(target, party, rng.int(3));
      if (r.campaign.won) { raidsWon++; const c = s.claimable(target)[0]; if (c && s.ledger.balance >= rf(520)) { s.claim(target, c.key); claims++; } }
    }
    const report = s.endDay();
    if (report.payout) firstRound = `round ${report.payout.round} pot ${formatRf(report.payout.pot)}: ` + report.payout.standings.map(x => `${x.name.slice(0, 12)} ${x.wins}w`).join(" | ");
    for (const rec of report.records) { if (rec.kind === "defense") { if (rec.reset || rec.campaign.won) resets++; else held++; } if (rec.kind === "outpost" && rec.campaign.won) evictions++; }
    log.push(formatRf(s.ledger.balance));
  }
  const you = s.standings().findIndex(x => x.you) + 1;
  const table = s.standings().map(x => `${x.name.slice(0, 12)} ${x.wins}w`).join(" | ");
  console.log(`#${player.tokenId} ${player.character.padEnd(9)} regions ${s.territory.regions.length} outposts ${s.held().length - s.territory.regions.filter(r => r.holder === "you").length} | raids won ${raidsWon} held ${held} lost ${resets} claims ${claims} evicted ${evictions} | rank ${you} pot ${formatRf(s.round.pot)} burned ${formatRf(s.ledger.burned)} | ${log.join(" ")}
   ${firstRound}
   now: ${table}`);
}
