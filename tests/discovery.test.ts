import test from "node:test";
import assert from "node:assert/strict";
import { parseAbiItem, type Address } from "viem";
import type { OwnedFriendsClient } from "@rarefriends/friendsdk/owned";
import { discoverFriends, pagedDiscoveryClient, verifyFriend } from "../host/discovery.ts";
import { GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const event = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const query = { address: GENERATION_SPRITE_MANIFEST.generations, event, args: { to: owner }, fromBlock: 0n, toBlock: 12_000_000n, strict: true } as const;
function mock(overrides: Record<string, unknown> = {}): OwnedFriendsClient {
  return { getChainId: async () => 4663, getBlockNumber: async () => 12_000_000n, getLogs: async () => [],
    readContract: async ({ functionName }: { functionName: string }) => functionName === "ownerOf" ? owner : functionName === "generation" ? 1 : functionName === "balanceOf" ? 1n : other,
    ...overrides } as unknown as OwnedFriendsClient;
}
test("history paging covers every block once, with fixed owner filters and snapshot end", async () => {
  const calls: typeof query[] = [];
  const c = pagedDiscoveryClient(mock({ getLogs: async (q: typeof query) => { calls.push(q); return []; } }));
  await c.getLogs(query);
  assert.deepEqual(calls.map(q => [q.fromBlock, q.toBlock]), [[0n, 4_999_999n], [5_000_000n, 9_999_999n], [10_000_000n, 12_000_000n]]);
  for (const q of calls) { assert.deepEqual(q.args, { to: owner }); assert.equal(q.address, query.address); assert.equal(q.strict, true); }
});
test("provider range rejection splits further without dropping blocks", async () => {
  const accepted: [bigint, bigint][] = [];
  const c = pagedDiscoveryClient(mock({ getLogs: async (q: typeof query) => {
    if (q.toBlock - q.fromBlock >= 2_000_000n) throw new Error("block range exceeds provider limit");
    accepted.push([q.fromBlock, q.toBlock]); return [];
  } }));
  await c.getLogs(query);
  assert.equal(accepted[0][0], 0n); assert.equal(accepted.at(-1)![1], query.toBlock);
  accepted.slice(1).forEach(([from], i) => assert.equal(from, accepted[i][1] + 1n));
});
test("offline errors fail instead of recursively retrying or returning an empty wallet", async () => {
  let calls = 0;
  const c = pagedDiscoveryClient(mock({ getLogs: async () => { calls++; throw new Error("offline"); } }));
  await assert.rejects(c.getLogs(query), /offline/); assert.equal(calls, 1);
});
test("cancelled sessions stop before another history request", async () => {
  const abort = new AbortController(); let calls = 0;
  const c = pagedDiscoveryClient(mock({ getLogs: async () => { calls++; abort.abort(); return []; } }), abort.signal);
  await assert.rejects(c.getLogs(query), { name: "AbortError" }); assert.equal(calls, 1);
});
test("incomplete transfer history remains an error despite successful RPC responses", async () => {
  await assert.rejects(discoverFriends(mock(), owner, new AbortController().signal), /incomplete/);
});
test("manual lookup requires ownership and a hardwired generation", async () => {
  assert.equal((await verifyFriend(mock(), owner, "#7730")).id, 7730n);
  const wrongOwner = mock({ readContract: async ({ functionName }: { functionName: string }) => functionName === "ownerOf" ? other : 1 });
  await assert.rejects(verifyFriend(wrongOwner, owner, "7730"), /different wallet/);
  const unhardwired = mock({ readContract: async ({ functionName }: { functionName: string }) => functionName === "ownerOf" ? owner : 0 });
  await assert.rejects(verifyFriend(unhardwired, owner, "7730"), /generation 0/);
});
test("invalid manual IDs never reach the network", async () => {
  const c = mock({ getChainId: () => { throw new Error("must not read"); } });
  for (const input of ["0", "-1", "abc", "1.2", "9".repeat(78)]) await assert.rejects(verifyFriend(c, owner, input), /valid Friend number/);
});
