import poolData from "./data/pool.json" with { type: "json" };

export const CHARACTERS = ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"] as const;
export const SCENERIES = ["Coastal", "Garden", "Industrial", "Market", "Mineral", "Orbital", "Reading", "Rooftop"] as const;
export const FLOORS = ["Cross Grid", "Hatch", "Dither", "Plain"] as const;
export type Character = typeof CHARACTERS[number];
export type Scenery = typeof SCENERIES[number];
export type Floor = typeof FLOORS[number];

/** One Generations NFT's six game-relevant traits plus its canonical 16 × 16 one-bit sprite frames. */
export type Friend = Readonly<{
  tokenId: bigint;
  generation: number;
  state: "Active" | "Inactive" | "Temporary";
  character: Character;
  seed: number;
  activationTier: number;
  scenery: Scenery;
  floor: Floor;
  /** 64 frames: idle down/up/left/right × 8, then walk down/up/left/right × 8. Bit 0 = top-left pixel. */
  frames: readonly bigint[];
  source: "chain" | "snapshot";
}>;

export type RawTraits = Readonly<{
  generation: unknown; state: unknown; character: unknown; seed: unknown;
  activationTier: unknown; scenery: unknown; floor: unknown;
}>;

function oneOf<T extends string>(list: readonly T[], value: unknown, name: string): T {
  if (typeof value !== "string" || !list.includes(value as T)) throw new Error(`Unknown ${name}: ${String(value)}`);
  return value as T;
}

function integer(value: unknown, name: string, min: number, max: number) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}: ${String(value)}`);
  return n;
}

export function makeFriend(tokenId: bigint, traits: RawTraits, frames: readonly bigint[], source: Friend["source"]): Friend {
  if (frames.length !== 64) throw new Error("A Friend needs exactly 64 sprite frames.");
  return Object.freeze({
    tokenId,
    generation: integer(traits.generation, "generation", 0, 255),
    state: oneOf(["Active", "Inactive", "Temporary"] as const, traits.state, "state"),
    character: oneOf(CHARACTERS, traits.character, "character"),
    seed: integer(traits.seed, "seed", 0, 0xffffffff),
    activationTier: integer(traits.activationTier, "activation tier", 0, 4),
    scenery: oneOf(SCENERIES, traits.scenery, "scenery"),
    floor: oneOf(FLOORS, traits.floor, "floor"),
    frames: Object.freeze([...frames]),
    source,
  });
}

type PoolFile = { source: { blockNumber: string; readAt: string }; friends: (RawTraits & { tokenId: string; frames: string[] })[] };
const file = poolData as unknown as PoolFile;

/** Fixed public recruit pool (see scripts/build-pool.mjs). Stand-in until the SDK exposes a player's other Friends. */
export const POOL: readonly Friend[] = Object.freeze(file.friends.map(f =>
  makeFriend(BigInt(f.tokenId), f, f.frames.map(hex => BigInt(`0x${hex}`)), "snapshot")));
export const POOL_SOURCE = Object.freeze({ blockNumber: file.source.blockNumber, readAt: file.source.readAt });

export function poolFriend(tokenId: bigint) {
  return POOL.find(f => f.tokenId === tokenId);
}

export const FACINGS = ["down", "up", "left", "right"] as const;
export type Facing = typeof FACINGS[number];

/** Frame bitmap for a facing and animation step. Colossus has no vertical art; it keeps its side view. */
export function spriteBits(friend: Friend, facing: Facing, walking: boolean, step: number, side: "left" | "right" = "right") {
  const resolved = friend.character === "Colossus" && (facing === "up" || facing === "down") ? side : facing;
  return friend.frames[(walking ? 32 : 0) + FACINGS.indexOf(resolved) * 8 + (step & 7)];
}

export function friendLabel(friend: Friend) {
  return `#${friend.tokenId} ${friend.character.toUpperCase()}`;
}
