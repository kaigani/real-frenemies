/**
 * Why did that happen? Two or three causal highlights and the objective progress for a finished campaign, derived
 * only from the event logs. Pure, so it is unit-tested and identical in replays.
 */
import type { Campaign } from "./campaign.ts";
import { CLASSES } from "./rules.ts";

export type Explanation = Readonly<{ progress: string; highlights: readonly string[] }>;

/** `you` is the side the reader is on in this campaign: "atk" when you raided, "def" when you defended. */
export function explain(campaign: Campaign, you: "atk" | "def"): Explanation {
  const battles = campaign.battles;
  const regionsTotal = campaign.cleared.length + campaign.unfought.length + battles.filter(b => !b.result.cleared).length;
  const defenders = battles.reduce((n, b) => n + new Set(b.defenders.map(d => d.key)).size, 0);
  const kos = battles.reduce((n, b) => n + b.result.defeated.length, 0);
  const progress = `${campaign.cleared.length}/${regionsTotal} REGIONS CLEARED · ${kos}/${defenders} DEFENDERS KO'D`;
  const out: string[] = [];
  const mine = (side: "atk" | "def") => side === you ? "YOUR" : "THEIR";

  // 1. Wounds carried between regions.
  battles.forEach((b, i) => {
    if (i === 0) return;
    const atk = b.result.units.filter(u => u.side === "atk");
    const pct = Math.round(100 * atk.reduce((n, u) => n + u.hp, 0) / Math.max(1, atk.reduce((n, u) => n + u.maxHp, 0)));
    if (pct < 90) out.push(`${mine("atk")} RAIDERS ENTERED ${b.name} AT ${pct}% HP`);
  });

  // 2. Flyers melee couldn't touch.
  for (const b of battles) {
    const atkMelee = b.result.units.some(u => u.side === "atk" && CLASSES[u.friend.character].kind === "melee");
    const defMelee = b.result.units.some(u => u.side === "def" && CLASSES[u.friend.character].kind === "melee");
    const flyer = (side: "atk" | "def") => b.result.units.find(u => u.side === side && CLASSES[u.friend.character].flyer
      && !b.result.events.some(e => e.e === "ko" && e.id === u.id));
    const f = atkMelee ? flyer("def") : defMelee ? flyer("atk") : undefined;
    if (f) { out.push(`${mine(f.side)} HOVERER WAS AIRBORNE: MELEE CAN'T HIT IT`); break; }
  }

  // 3. Units that never landed a hit, and who did the most damage.
  const dealt = new Map<string, { side: "atk" | "def"; name: string; dmg: number }>();
  for (const b of battles) {
    for (const u of b.result.units) {
      const k = `${u.side}:${u.key}`;
      if (!dealt.has(k)) dealt.set(k, { side: u.side, name: u.core ? "CORE" : u.friend.character.toUpperCase(), dmg: 0 });
    }
    for (const e of b.result.events) if (e.e === "hit" && !e.miss && e.id >= 0) {
      const u = b.result.units[e.id];
      dealt.get(`${u.side}:${u.key}`)!.dmg += e.dmg;
    }
  }
  const idle = [...dealt.values()].filter(d => d.side === you && d.dmg === 0 && d.name !== "CORE");
  if (idle.length) out.push(`${mine(you)} ${idle[0].name} NEVER LANDED A HIT${idle.length > 1 ? ` (+${idle.length - 1} MORE)` : ""}`);
  const enemy = you === "atk" ? "def" : "atk";
  const top = [...dealt.values()].filter(d => d.side === enemy).sort((a, b) => b.dmg - a.dmg)[0];
  const taken = [...dealt.values()].filter(d => d.side === enemy).reduce((n, d) => n + d.dmg, 0);
  if (top && top.dmg > 0 && taken > 0) out.push(`THEIR ${top.name} DEALT ${top.dmg} OF ${taken} DAMAGE TO YOU`);

  // 4. Timeouts.
  const timeout = battles.find(b => b.result.reason === "time");
  if (timeout) {
    const pieces = new Set(timeout.defenders.map(d => d.key)).size - timeout.result.defeated.length;
    const core = timeout.core && !timeout.result.coreDown;
    const standing = pieces + (core ? 1 : 0);
    out.push(pieces === 0 && core ? `TIME RAN OUT IN ${timeout.name}: THE CORE HELD ALONE`
      : `TIME RAN OUT IN ${timeout.name} WITH ${standing} DEFENDER${standing === 1 ? "" : "S"} STANDING`);
  }
  return Object.freeze({ progress, highlights: Object.freeze(out.slice(0, 3)) });
}
