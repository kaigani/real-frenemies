import { createPublicClient, http, parseAbi } from "viem";
import { createGenerationSpriteReader, GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
import { makeFriend, poolFriend, type Friend } from "./friends.ts";
import { traitsFromTokenUri } from "./onchain-parse.ts";

const TOKEN_URI_ABI = parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]);

/** Public read-only views on the Generations contract. The sandbox CSP allows only this RPC. */
const client = createPublicClient({
  transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, { retryCount: 2, timeout: 15_000 }),
});
const sprites = createGenerationSpriteReader(client);

/** The chain's current block: the round clock starts here. Null when the read fails (the game then counts from block 0). */
export async function readBlockNumber(): Promise<number | null> {
  try { return Number(await client.getBlockNumber({ cacheTime: 0 })); }
  catch { return null; }
}

/**
 * The selected Friend's traits and sprite frames. Friends in the recruit-pool snapshot (including the SDK test
 * fixture #7730) load from that snapshot and are labelled SNAPSHOT in the game; every other Friend is read live.
 * Errors propagate so the game can offer a retry.
 */
export async function readFriend(tokenId: bigint, signal?: AbortSignal): Promise<Friend> {
  const snapshot = poolFriend(tokenId);
  if (snapshot) return snapshot;
  const [uri, art] = await Promise.all([
    client.readContract({ address: GENERATION_SPRITE_MANIFEST.generations, abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [tokenId] }),
    sprites.read(tokenId),
  ]);
  signal?.throwIfAborted();
  return makeFriend(tokenId, traitsFromTokenUri(uri), art.frames, "chain");
}
