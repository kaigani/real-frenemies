/** Live check of the in-game chain read path against Robinhood mainnet. Run: node scripts/live-read.ts [tokenId] */
import { readFriend } from "../game/src/onchain.ts";
const id = BigInt(process.argv[2] ?? "80000");
const f = await readFriend(id);
console.log({ tokenId: f.tokenId, source: f.source, generation: f.generation, state: f.state, character: f.character,
  seed: f.seed, activationTier: f.activationTier, scenery: f.scenery, floor: f.floor, frames: f.frames.length });
