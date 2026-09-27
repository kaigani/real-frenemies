/** Monte Carlo raid economics: random parties against each persistent rival's whole territory. Run: node scripts/raid-ev.ts [atkMul] */
import { runCampaign } from "../game/src/campaign.ts";
import { feeFor, formatRf, percent, stakeAt } from "../game/src/economy.ts";
import { POOL } from "../game/src/friends.ts";
import { buildRivals } from "../game/src/ghosts.ts";
import { createRng } from "../game/src/rng.ts";
import { CAPTURE_BURN_PERCENT } from "../game/src/rules.ts";
import { YOU } from "../game/src/territory.ts";

const atkMul = Number(process.argv[2] ?? 1);
const rng = createRng(12345);
const rows: string[] = [`attack multiplier ×${atkMul}`];
for (let seed = 1; seed <= 3; seed++) {
  const rivals = buildRivals(POOL, new Set(), seed * 1000);
  for (const rival of rivals) {
    for (const size of [2, 4]) for (const level of [1, 2, 3, 4]) {
      let wins = 0, net = 0n, kills = 0;
      const N = 60;
      for (let i = 0; i < N; i++) {
        for (const r of rivals) r.restore(rivals.map(x => x.territory));
        const taken = rival.friendIds();
        const options = POOL.filter(f => !taken.has(f.tokenId));
        const party = Array.from({ length: size }, () => options.splice(rng.int(options.length), 1)[0]).map(f => ({ key: `#${f.tokenId}`, friend: f, level }));
        const c = runCampaign({ target: rival.territory, attacker: YOU, attackers: party, lane: rng.int(3), seed: rng.next(), atkMul, defMul: () => 1,
          core: { friend: rival.core, level: rival.coreLevel } });
        let captured = 0n;
        for (const b of c.battles) {
          for (const key of b.result.defeated) { const p = b.defenders.find(d => d.key === key)!; captured += stakeAt(p.level) - percent(stakeAt(p.level), CAPTURE_BURN_PERCENT); kills++; }
          if (b.result.coreDown) captured += stakeAt(rival.coreLevel) - percent(stakeAt(rival.coreLevel), CAPTURE_BURN_PERCENT);
        }
        if (c.won) wins++;
        net += captured - feeFor(size);
      }
      rows.push(`seed ${seed} ${rival.difficulty.padEnd(6)} ${rival.territory.regions.length}r ${size}x L${level}: win ${String(Math.round(100 * wins / N)).padStart(3)}%  kills ${(kills / N).toFixed(1)}  avg net ${formatRf(net / BigInt(N), true).padStart(6)} RF`);
    }
  }
}
console.log(rows.join("\n"));
