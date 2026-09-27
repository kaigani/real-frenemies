import type { Character, Friend, Scenery } from "./friends.ts";

export const GRID_W = 12;
export const GRID_H = 8;
export const MAX_GARRISON = 6;
export const MAX_RAIDERS = 4;
export const MAX_LEVEL = 4;
export const TICK_CAP = 200;
export const TICKS_PER_SECOND = 10;
/** Attackers enter from column 0 on one of three lanes; defenders may not be placed west of BUILD_MIN_X. */
export const LANE_ROWS = [1, 4, 6] as const;
export const BUILD_MIN_X = 3;

/** Whole RF per level: activation stakes 1, each level-up tops up double the previous amount. */
export const LEVEL_TOPUP = [0, 1, 1, 2, 4] as const;
export const LEVEL_STAKE = [0, 1, 2, 4, 8] as const;
export const RAID_FEE_BASE = 2;
export const RAID_FEE_PER_ATTACKER = 1;
export const FEE_BURN_PERCENT = 20n;
export const CAPTURE_BURN_PERCENT = 10n;

export type PowerSlots = 1 | 2 | 3;
export const GENERATION_BUDGET: Readonly<Record<number, Readonly<{ hp: number; dmg: number; slots: PowerSlots }>>> = {
  1: { hp: 12, dmg: 4, slots: 3 },
  2: { hp: 11, dmg: 3, slots: 3 },
  3: { hp: 10, dmg: 3, slots: 2 },
  4: { hp: 8, dmg: 2, slots: 2 },
  5: { hp: 7, dmg: 2, slots: 1 },
  6: { hp: 6, dmg: 1, slots: 1 },
};

export function budget(generation: number) {
  if (generation < 1) throw new Error("Generation 0 (Temporary) Friends cannot be placed.");
  return GENERATION_BUDGET[Math.min(generation, 6)];
}

/** How a unit's basic attack lands: melee cannot touch flyers; ranged hits flyers for double. */
export type AttackKind = "melee" | "ranged" | "air";
export type Reach = "Melee" | "Ranged" | "Flyer";
export type Numbers = "Area" | "Swarm" | "Single" | "Support";
type Power = Readonly<{ name: string; text: string }>;
export type ClassDef = Readonly<{
  role: string; kind: AttackKind; reach: Reach; numbers: Numbers;
  hpMul: number; dmgAdd: number; range: number; moveCd: number; atkCd: number; flyer: boolean;
  /** Always-on class trait: never suppressed by Library tiles. */
  trait: string;
  defense: Power; offense: Power; upgrade: Power;
}>;

export const CLASSES: Readonly<Record<Character, ClassDef>> = {
  Colossus: { role: "Tank", kind: "melee", reach: "Melee", numbers: "Area", hpMul: 1.6, dmgAdd: 0, range: 1, moveCd: 3, atkCd: 3, flyer: false,
    trait: "Heavy: 1.6x HP, slow",
    defense: { name: "Bulwark", text: "Enemies next to it must attack it" },
    offense: { name: "Siege", text: "Double damage to walls and the Core" },
    upgrade: { name: "Earthshake", text: "When hit, stuns adjacent enemies 1 tick" } },
  Hoverer: { role: "Flyer", kind: "air", reach: "Flyer", numbers: "Single", hpMul: 0.6, dmgAdd: 0, range: 1, moveCd: 1, atkCd: 2, flyer: true,
    trait: "Flies: melee can't hit it; ranged hits it for 2x",
    defense: { name: "Overwatch", text: "Range 2; sees hidden units" },
    offense: { name: "Skyline", text: "Flies over walls straight for the Core" },
    upgrade: { name: "Dive", text: "First hit on a grounded unit is x2" } },
  Hollow: { role: "Phantom", kind: "melee", reach: "Flyer", numbers: "Single", hpMul: 1.0, dmgAdd: 0, range: 1, moveCd: 2, atkCd: 2, flyer: false,
    trait: "Phantom: takes half damage from melee",
    defense: { name: "Void", text: "Adjacent enemies lose 1 HP every 2 ticks" },
    offense: { name: "Phase-step", text: "Teleports past the first defender it meets" },
    upgrade: { name: "Consume", text: "Heals 2 HP on each kill" } },
  Sparkling: { role: "Burst caster", kind: "ranged", reach: "Ranged", numbers: "Area", hpMul: 0.7, dmgAdd: -1, range: 2, moveCd: 2, atkCd: 3, flyer: false,
    trait: "Ranged 2: hits flyers for 2x",
    defense: { name: "Nova", text: "Every 3 ticks hits all enemies in radius 2 for 2" },
    offense: { name: "Flare", text: "Every 4 ticks: 1 damage to enemies in radius 2; they miss 50% for 2 ticks" },
    upgrade: { name: "Supernova", text: "Nova radius 3; costs itself 1 HP" } },
  Skeleton: { role: "Striker", kind: "melee", reach: "Melee", numbers: "Single", hpMul: 1.0, dmgAdd: 0, range: 1, moveCd: 2, atkCd: 2, flyer: false,
    trait: "Striker: melee",
    defense: { name: "Bone Rush", text: "Free first strike on anything that comes adjacent" },
    offense: { name: "Rattle", text: "+2 damage on its first hit on each piece" },
    upgrade: { name: "Reassemble", text: "Revives once at 3 HP" } },
  Mask: { role: "Trickster", kind: "melee", reach: "Melee", numbers: "Support", hpMul: 0.9, dmgAdd: 0, range: 1, moveCd: 2, atkCd: 2, flyer: false,
    trait: "Trickster: melee",
    defense: { name: "Decoy", text: "When targeted, swaps with an ally; the hit is wasted" },
    offense: { name: "Disguise", text: "Ignored by defenders until it strikes" },
    upgrade: { name: "Mirror", text: "Reflects 1 damage per hit taken" } },
  Family: { role: "Swarm", kind: "melee", reach: "Melee", numbers: "Swarm", hpMul: 1.5, dmgAdd: 0, range: 1, moveCd: 2, atkCd: 2, flyer: false,
    trait: "Three bodies: 3 minis, each 1/3 HP and 1/2 damage",
    defense: { name: "Brood", text: "Minis next to another mini take 1 less damage (min 1)" },
    offense: { name: "Mob", text: "All 3 minis focus one target" },
    upgrade: { name: "Reunion", text: "The last mini standing merges back to full HP" } },
  Cellular: { role: "Support", kind: "melee", reach: "Melee", numbers: "Support", hpMul: 1.1, dmgAdd: -1, range: 1, moveCd: 3, atkCd: 2, flyer: false,
    trait: "Support: melee, slow",
    defense: { name: "Mitosis", text: "Heals adjacent allies 1 HP every 2 ticks" },
    offense: { name: "Spore", text: "Leaves a 1-HP spore behind each move that blocks shots" },
    upgrade: { name: "Culture", text: "Heal reaches radius 2" } },
  Asymmetry: { role: "Ranged", kind: "ranged", reach: "Ranged", numbers: "Single", hpMul: 0.8, dmgAdd: -1, range: 3, moveCd: 2, atkCd: 3, flyer: false,
    trait: "Ranged 3: hits flyers for 2x",
    defense: { name: "Ricochet", text: "Shots bounce to a 2nd target for half; ignore Decoy" },
    offense: { name: "Long Shot", text: "+1 damage on its first shot at each target" },
    upgrade: { name: "Skew", text: "Shots pass through walls and allies" } },
};

export const AFFINITY: Readonly<Record<Scenery, Readonly<{ terrain: string; bonus: string }>>> = {
  Coastal: { terrain: "Water: ground units at half speed", bonus: "Full speed on water; Tide pushes an adjacent enemy every 4 ticks" },
  Garden: { terrain: "Overgrowth hides units until an enemy is adjacent", bonus: "Ambush: first strike from hiding is x2" },
  Industrial: { terrain: "Conveyors push units 1 tile every 2 ticks", bonus: "+1 armor (min 1 damage)" },
  Market: { terrain: "Stalls: 2-HP breakable cover", bonus: "Haggle: if defeated, pays only half its stake" },
  Mineral: { terrain: "Crystal walls: 4-HP obstacles", bonus: "Crystallize: 2-HP shield when a wall breaks nearby" },
  Orbital: { terrain: "Zero-g: every unit on it counts as a flyer", bonus: "+1 range" },
  Reading: { terrain: "Library: no powers trigger inside", bonus: "Study: -1 power cooldown next to another Reading piece" },
  Rooftop: { terrain: "Ledges: one-way drops eastward", bonus: "High ground: +1 range and shoots over walls" },
};

export const FLOOR_RULES = {
  "Cross Grid": { moves: "Orthogonal only", quirk: "+1 speed after 2 straight tiles" },
  Hatch: { moves: "Diagonal, cuts corners", quirk: "A single wall can't block it" },
  Dither: { moves: "Any direction, 3/4 speed", quirk: "25% of incoming hits miss" },
  Plain: { moves: "Orthogonal, standard", quirk: "+1 HP" },
} as const;

/** Everything the sim needs about one piece, derived from its traits and paid level. */
export type UnitStats = Readonly<{
  maxHp: number; dmg: number; range: number; moveCd: number; atkCd: number;
  slots: PowerSlots; cdReduction: number; upgrade: boolean; affinity: boolean; floorQuirk: boolean;
}>;

const LEVEL_HP = [0, 1, 1.25, 1.5, 2];
const LEVEL_DMG = [0, 0, 1, 2, 3];

/** Territory: expansions, flag claims, the reward pot and the block-count round. Whole RF. */
export const EXPAND_COST = 250;
export const CLAIM_COST = 500;
export const RECLAIM_COST = 250;
/** Home plus up to four expansions, all inside the 3 × 3 territory map. */
export const MAX_REGIONS = 5;
/** Each extra region its holder controls adds this much attack (raiding) and defense (HP) — capped at 4 regions. */
export const REGION_BONUS = 0.15;
/** Robinhood mainnet runs at roughly 0.1 s per block, so a day is about 864,000 blocks and a round is 7 days. */
export const BLOCKS_PER_DAY = 864_000;
export const ROUND_DAYS = 7;
export const ROUND_BLOCKS = BLOCKS_PER_DAY * ROUND_DAYS;
export const POT_SPLIT = [50n, 25n, 25n] as const;

/** Supply: each region supports this much; a piece costs its level. The Core costs nothing. */
export const SUPPLY_PER_REGION = 12;
/** A region counts toward the territory bonus only while this many of its holder's pieces garrison it. */
export const GARRISON_FOR_BONUS = 2;
/** Rebuild cooldown: whoever is beaten (every region cleared) or loses their Core can't be raided for this many nights. */
export const REBUILD_NIGHTS = 2;
/** Every ghost starts with the same simulated wallet as the player and pays for everything from it. */
export const GHOST_START_RF = 500;
/** Tonight's threat level (1-8): +1 after a night you hold, -1 after a night you lose. */
export const MAX_THREAT = 8;
/** Library suppression contract: a unit standing on a Library tile can't use its D / R / 4 powers or its Scenery
 *  affinity. Basic attacks, class traits, Floor movement and quirks, and Active regeneration still apply. */
export const SUPPRESSION_RULE = "Library: no D/R/4 powers or affinity; traits, floors and basic attacks still work";

export function territoryMultiplier(extraRegions: number) {
  return 1 + REGION_BONUS * Math.max(0, Math.min(4, extraRegions));
}

export function unitStats(friend: Friend, level: number, boardScenery: Scenery,
  options: { core?: boolean; attacking?: boolean; atkMul?: number; defMul?: number } = {}): UnitStats {
  if (level < 1 || level > MAX_LEVEL) throw new RangeError("Level must be 1-4.");
  const def = CLASSES[friend.character], gen = budget(friend.generation);
  const affinity = gen.slots >= 2 && friend.scenery === boardScenery;
  const floorQuirk = gen.slots >= 3;
  let maxHp = Math.max(1, Math.round(gen.hp * def.hpMul * LEVEL_HP[level])) + friend.activationTier;
  if (floorQuirk && friend.floor === "Plain") maxHp += 1;
  if (options.core) maxHp = Math.round(maxHp * 1.5);
  if (options.defMul) maxHp = Math.max(1, Math.round(maxHp * options.defMul));
  let range = def.range;
  if (!options.attacking && friend.character === "Hoverer") range = 2;
  if (affinity && (friend.scenery === "Orbital" || friend.scenery === "Rooftop")) range += 1;
  let moveCd = def.moveCd;
  if (friend.floor === "Dither") moveCd = Math.ceil(moveCd * 4 / 3);
  const dmg = Math.max(1, Math.round((gen.dmg + def.dmgAdd + LEVEL_DMG[level]) * (options.attacking && options.atkMul ? options.atkMul : 1)));
  return Object.freeze({
    maxHp, dmg, range, moveCd, atkCd: def.atkCd,
    slots: gen.slots, cdReduction: level >= 3 ? 1 : 0,
    upgrade: level === 4 || (level === 3 && friend.activationTier === 4),
    affinity, floorQuirk,
  });
}

export function raidFee(attackers: number) {
  return RAID_FEE_BASE + RAID_FEE_PER_ATTACKER * attackers;
}

export function slotNames(slots: PowerSlots) {
  return slots === 3 ? "Character + Scenery + Floor" : slots === 2 ? "Character + Scenery" : "Character";
}
