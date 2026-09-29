import { readOwnedFriends, type OwnedFriendsClient, type OwnedFriend } from "@rarefriends/friendsdk/owned";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
import { isAddress, parseAbi, zeroAddress, type Address } from "viem";

const BLOCK_WINDOW = 5_000_000n;
type Progress = (completed: number, total: number) => void;

/** Preserve the SDK's owner filters and snapshot validation while respecting RPC range limits. */
export function pagedDiscoveryClient(client: OwnedFriendsClient, signal?: AbortSignal, progress?: Progress): OwnedFriendsClient {
  let completed = 0, total = 0, requests = 0;
  const active = () => signal?.throwIfAborted();
  const getLogs = async (parameters: Parameters<OwnedFriendsClient["getLogs"]>[0]) => {
    if (!parameters || parameters.blockHash) throw new Error("Discovery needs a fixed block range.");
    const { fromBlock, toBlock } = parameters;
    if (typeof fromBlock !== "bigint" || typeof toBlock !== "bigint" || fromBlock < 0n || toBlock < fromBlock) throw new Error("Discovery needs a fixed block range.");
    total += Number((toBlock - fromBlock) / BLOCK_WINDOW + 1n); progress?.(completed, total);
    async function range(from: bigint, to: bigint): Promise<Awaited<ReturnType<OwnedFriendsClient["getLogs"]>>> {
      active();
      if (++requests > 512) throw new Error("Friend history is too large to load right now. Try a Friend number below.");
      try {
        const logs = await client.getLogs({ ...parameters, blockHash: undefined, fromBlock: from, toBlock: to });
        active(); completed++; progress?.(completed, total); return logs;
      } catch (error) {
        active();
        // Split only provider size-limit failures. Offline/authentication errors must remain errors.
        const message = error instanceof Error ? error.message : String(error);
        if (to <= from || !/block range|query spans|too many (results|logs)|response size|result.*limit|range.*limit/i.test(message)) throw error;
        total++; progress?.(completed, total);
        const middle = (from + to) / 2n;
        return [...await range(from, middle), ...await range(middle + 1n, to)];
      }
    }
    const result: Awaited<ReturnType<OwnedFriendsClient["getLogs"]>> = [];
    for (let from = fromBlock; from <= toBlock; from += BLOCK_WINDOW) {
      result.push(...await range(from, from + BLOCK_WINDOW - 1n < toBlock ? from + BLOCK_WINDOW - 1n : toBlock));
    }
    return result;
  };
  return { getLogs: getLogs as OwnedFriendsClient["getLogs"], getChainId: (...args) => client.getChainId(...args), getBlockNumber: (...args) => client.getBlockNumber(...args), readContract: client.readContract };
}

export function discoverFriends(client: OwnedFriendsClient, account: Address, signal: AbortSignal, progress?: Progress) {
  return readOwnedFriends(pagedDiscoveryClient(client, signal, progress), account, { signal });
}

/** Recovery by a player-supplied ID still proves ownership, generation and canonical wallet on chain. */
export async function verifyFriend(client: OwnedFriendsClient, account: Address, input: string, signal?: AbortSignal): Promise<OwnedFriend> {
  const value = input.trim().replace(/^#/, "");
  if (!/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 1n << 256n) throw new Error("Enter a valid Friend number, such as 7730.");
  signal?.throwIfAborted();
  const id = BigInt(value), identity = await readGenerationEligibility(client, id, account);
  signal?.throwIfAborted();
  if (!identity.ownedByPlayer) throw new Error("This Friend belongs to a different wallet. Check the number or switch accounts.");
  if (!identity.hardwired) throw new Error("This Friend is generation 0. Choose a hardwired Friend (generation 1 or higher).");
  const walletAddress = await client.readContract({ address: GENERATION_SPRITE_MANIFEST.generations,
    abi: parseAbi(["function tokenBoundAccount(uint256 tokenId) view returns (address)"]), functionName: "tokenBoundAccount", args: [id], blockNumber: identity.blockNumber });
  signal?.throwIfAborted();
  if (!isAddress(walletAddress) || walletAddress.toLowerCase() === zeroAddress || await client.getChainId() !== GENERATION_SPRITE_MANIFEST.chainId) throw new Error("Could not verify this Friend. Check your network and try again.");
  return { id, label: `Friend #${id}`, kind: "owned", walletAddress, generation: identity.generation };
}
