/**
 * Solo play: three AI rivals that persist for the whole session. Each has a territory, garrisons built to a supply
 * budget, and a finite simulated wallet: it pays raid fees, flag purchases and every morning's re-stake of lost
 * pieces from that wallet, exactly like the player. Everything is seeded.
 */
import type { Character, Friend } from "./friends.ts";
import { stakeAt } from "./economy.ts";
import { createRng, mixSeed, type Rng } from "./rng.ts";
import { CLASSES, GHOST_START_RF, GRID_H, GRID_W, LANE_ROWS, SUPPLY_PER_REGION, unitStats } from "./rules.ts";
import type { AttackerInput } from "./sim.ts";
import { buildable, type Board } from "./terrain.ts";
import { createTerritory, expandTerritory, expansionOptions, supplyUsed, type HolderId, type Piece, type Region, type Territory } from "./territory.ts";

export type Difficulty = "Easy" | "Medium" | "Hard";

const ARCHETYPES: readonly Readonly<{ name: string; wants: readonly Character[] }>[] = [
  { name: "Wall", wants: ["Colossus", "Cellular", "Asymmetry"] },
  { name: "Turret line", wants: ["Asymmetry", "Asymmetry", "Mask"] },
  { name: "Swarm", wants: ["Family", "Family", "Cellular"] },
  { name: "Trap base", wants: ["Mask", "Skeleton", "Hollow"] },
  { name: "Glass cannon", wants: ["Sparkling", "Skeleton", "Hoverer"] },
  { name: "Mixed", wants: [] },
];
const FRONT = new Set<Character>(["Colossus", "Skeleton", "Family", "Hollow", "Mask"]);
/** Supply budget per region (home / expansion), piece levels, Core level and number of regions per difficulty. */
const SHAPE: Record<Difficulty, Readonly<{ home: number; region: number; levels: [number, number]; core: number; regions: number }>> = {
  Easy: { home: 5, region: 3, levels: [1, 2], core: 2, regions: 2 },
  Medium: { home: 9, region: 5, levels: [2, 3], core: 3, regions: 2 },
  Hard: { home: 12, region: 7, levels: [3, 4], core: 4, regions: 3 },
};

export const pieceKey = (friend: Friend) => `#${friend.tokenId}`;

function pickFriend(rng: Rng, pool: readonly Friend[], want: Character | undefined, taken: Set<bigint>) {
  const options = pool.filter(f => (!want || f.character === want) && !taken.has(f.tokenId));
  const f = options.length ? options[rng.int(options.length)] : undefined;
  if (f) taken.add(f.tokenId);
  return f;
}

/** Front-line classes sit mid-board on a lane; the rest guard the Core (or the flag). */
export function placeGarrison(rng: Rng, board: Board, friends: readonly Friend[], levels: readonly number[], occupied: readonly Piece[] = []): Piece[] {
  const used = new Set<string>([`${board.core.x},${board.core.y}`, ...occupied.map(p => `${p.x},${p.y}`)]);
  const placed: Piece[] = [];
  friends.forEach((friend, i) => {
    const front = FRONT.has(friend.character);
    const lane = LANE_ROWS[rng.int(LANE_ROWS.length)];
    const spots: { x: number; y: number; score: number }[] = [];
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      if (!buildable(board, x, y) || used.has(`${x},${y}`)) continue;
      const toCore = Math.max(Math.abs(x - board.core.x), Math.abs(y - board.core.y));
      const score = front ? Math.abs(x - 6) * 2 + Math.abs(y - lane) : toCore * 2 + Math.abs(y - board.core.y);
      spots.push({ x, y, score: score + rng.int(3) });
    }
    spots.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
    const spot = spots[0];
    if (!spot) return;
    used.add(`${spot.x},${spot.y}`);
    placed.push({ key: pieceKey(friend), friend, level: levels[i], x: spot.x, y: spot.y });
  });
  return placed;
}

export class Rival {
  readonly id: HolderId;
  readonly index: number;
  readonly difficulty: Difficulty;
  readonly archetype: string;
  readonly core: Friend;
  readonly coreTemplateLevel: number;
  coreLevel: number;
  readonly territory: Territory;
  /** Garrison per region key; knocked-out or captured pieces come back from here each morning, paid from the wallet. */
  readonly template = new Map<string, Piece[]>();
  /** Simulated RF wallet. */
  wallet: bigint;
  /** Raiders knocked out tonight: still staked, off the board until morning. */
  readonly down = new Set<string>();

  constructor(index: number, difficulty: Difficulty, pool: readonly Friend[], taken: Set<bigint>, seed: number) {
    const rng = createRng(mixSeed("rival", seed, index, difficulty));
    const shape = SHAPE[difficulty];
    this.id = `rival-${index}`;
    this.index = index;
    this.difficulty = difficulty;
    this.wallet = BigInt(GHOST_START_RF) * 10n ** 18n;
    const coreOptions = pool.filter(f => !taken.has(f.tokenId));
    this.core = coreOptions[rng.int(coreOptions.length)];
    taken.add(this.core.tokenId);
    this.coreTemplateLevel = shape.core;
    this.coreLevel = shape.core;
    this.territory = createTerritory(this.id, this.core);
    const archetype = ARCHETYPES[rng.int(ARCHETYPES.length)];
    this.archetype = archetype.name;
    for (let i = 1; i < shape.regions; i++) {
      const options = expansionOptions(this.territory);
      const pick = options[rng.int(options.length)];
      expandTerritory(this.territory, pick.dx, pick.dy);
    }
    for (const region of this.territory.regions) {
      // Spend the region's supply budget: pieces at the difficulty's levels until the budget is used.
      const budget = Math.min(SUPPLY_PER_REGION, region.home ? shape.home : shape.region);
      const friends: Friend[] = [], levels: number[] = [];
      let left = budget, w = 0;
      while (left >= shape.levels[0] && friends.length < 6) {
        const level = Math.min(left, shape.levels[0] + rng.int(shape.levels[1] - shape.levels[0] + 1));
        const f = pickFriend(rng, pool, region.home ? archetype.wants[w++] : undefined, taken);
        if (!f) break;
        friends.push(f); levels.push(level); left -= level;
      }
      this.template.set(region.key, placeGarrison(rng, region.board, friends, levels));
    }
    // Opening garrisons are the ghost's starting position (already staked), not a purchase.
    for (const r of this.territory.regions) r.garrison = (this.template.get(r.key) ?? []).map(p => ({ ...p }));
  }

  get name() { return `GHOST #${this.core.tokenId}`; }

  /** Every Friend this ghost fields, so the player's recruit pool can exclude them. */
  friendIds() {
    const ids = new Set<bigint>([this.core.tokenId]);
    for (const pieces of this.template.values()) for (const p of pieces) ids.add(p.friend.tokenId);
    return ids;
  }

  home(): Region { return this.territory.regions.find(r => r.home)!; }

  /** Pieces able to fight now (not knocked out on tonight's raid). */
  present(r: Region) { return r.garrison.filter(p => !this.down.has(p.key)); }

  /** Staked RF across every region it holds (any territory), plus the Core. */
  staked(territories: readonly Territory[]) {
    let sum = this.coreLevel ? stakeAt(this.coreLevel) : 0n;
    for (const t of territories) for (const r of t.regions) if (r.holder === this.id) for (const p of r.garrison) sum += stakeAt(p.level);
    return sum;
  }

  /**
   * Morning: raiders who were knocked out are back on their feet. Missing template pieces in regions it holds are
   * re-staked from the wallet while it can afford them, Core first. Returns the RF spent.
   */
  restore(territories: readonly Territory[]) {
    this.down.clear();
    let spent = 0n;
    const pay = (amount: bigint) => { if (this.wallet < amount) return false; this.wallet -= amount; spent += amount; return true; };
    if (!this.coreLevel && pay(stakeAt(this.coreTemplateLevel))) this.coreLevel = this.coreTemplateLevel;
    const onBoard = new Set<string>();
    for (const t of territories) for (const r of t.regions) if (r.holder === this.id) for (const p of r.garrison) onBoard.add(p.key);
    for (const r of [...this.territory.regions].sort((a, b) => (b.home ? 1 : 0) - (a.home ? 1 : 0))) {
      if (r.holder !== this.id) continue;
      for (const p of this.template.get(r.key) ?? []) {
        if (onBoard.has(p.key)) continue;
        if (supplyUsed(r) + p.level > SUPPLY_PER_REGION) continue;
        if (r.garrison.some(q => q.x === p.x && q.y === p.y)) continue;
        if (!pay(stakeAt(p.level))) return spent;
        r.garrison.push({ ...p });
        onBoard.add(p.key);
      }
    }
    return spent;
  }

  /** Raiding party from the home garrison: the strongest pieces first. */
  party(size: number, rng: Rng): AttackerInput[] {
    const home = [...this.present(this.home())].sort((a, b) => b.level - a.level || rng.int(3) - 1);
    return home.slice(0, Math.max(0, size)).map(p => ({ key: p.key, friend: p.friend, level: p.level }));
  }

  /** The ghost's surviving raiders move in as residents, within the region's supply; the rest stay home. */
  moveIn(region: Region, survivors: readonly AttackerInput[], rng: Rng) {
    const home = this.home();
    const moving: Piece[] = [];
    let supply = 0;
    for (const p of home.garrison) {
      if (!survivors.some(s => s.key === p.key) || supply + p.level > SUPPLY_PER_REGION) continue;
      moving.push(p); supply += p.level;
    }
    home.garrison = home.garrison.filter(p => !moving.includes(p));
    region.holder = this.id;
    region.garrison = placeGarrison(rng, region.board, moving.map(p => p.friend), moving.map(p => p.level));
  }
}

const DIFFICULTIES: readonly Difficulty[] = ["Easy", "Medium", "Hard"];

export function buildRivals(pool: readonly Friend[], exclude: ReadonlySet<bigint>, seed: number): Rival[] {
  const taken = new Set(exclude);
  return DIFFICULTIES.map((d, i) => new Rival(i, d, pool, taken, seed));
}

/** Lane with the least defending damage near it. */
export function weakestLane(board: Board, defenders: readonly Piece[]) {
  const threat = LANE_ROWS.map(row => defenders.reduce((sum, d) =>
    sum + unitStats(d.friend, d.level, board.scenery).dmg * 10 / (1 + Math.abs(d.y - row)), 0));
  return threat.indexOf(Math.min(...threat));
}

export function counterPicks(defenders: readonly Piece[]): Character[] {
  const reach = (r: string) => defenders.filter(d => CLASSES[d.friend.character].reach === r).length;
  const wants: Character[] = [];
  if (reach("Melee") >= 2) wants.push("Hoverer");
  if (reach("Ranged") >= 2) wants.push("Skeleton");
  if (defenders.some(d => d.friend.character === "Family")) wants.push("Sparkling");
  if (defenders.some(d => d.friend.character === "Sparkling")) wants.push("Asymmetry");
  if (defenders.some(d => d.friend.character === "Colossus")) wants.push("Hollow");
  return wants;
}
