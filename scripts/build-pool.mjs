#!/usr/bin/env node
/**
 * Builds game/src/data/pool.json: a fixed public recruit pool of hardwired Generations Friends.
 * Reads only public contract views on Robinhood mainnet. Deterministic for a given chain state:
 * token IDs are sampled on a fixed stride, then picked for Character / Scenery / Floor coverage.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { createPublicClient, http, parseAbi } from "viem";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
const REGISTRY = "0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D";
const FAMILIES = ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"];
const PER_FAMILY = 8;
// The SDK test harness's sample Friend; keeping it in the snapshot lets mocked runs load real traits.
const ALWAYS_INCLUDE = [7730n, 3412n];

const abi = parseAbi([
  "function generation(uint256) view returns (uint8)",
  "function tokenURI(uint256) view returns (string)",
  "function familyOf(uint256) pure returns (uint8)",
  "function frames(uint8 id, uint32 seed) view returns (uint256[64])",
]);
const client = createPublicClient({ transport: http(RPC, { batch: { batchSize: 25 }, retryCount: 4, retryDelay: 800 }) });

async function inChunks(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(work)));
  return out;
}

function parseMetadata(uri) {
  const json = JSON.parse(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8"));
  const attr = Object.fromEntries(json.attributes.map(a => [a.trait_type, a.value]));
  return {
    generation: Number(attr.Generation), state: String(attr.State), character: String(attr.Character),
    seed: Number(attr.Seed), activationTier: Number(attr["Activation tier"]),
    scenery: String(attr.Scenery), floor: String(attr.Floor),
  };
}

const blockNumber = await client.getBlockNumber();
console.log(`Reading at block ${blockNumber}`);

// 1. Sample IDs on a fixed stride and keep hardwired ones.
const sampled = [];
for (let id = 7n; id <= 102_000n; id += 59n) sampled.push(id);
const generations = await inChunks(sampled, 25, id =>
  client.readContract({ address: GENERATIONS, abi, functionName: "generation", args: [id], blockNumber }).catch(() => 0));
const hardwired = sampled.filter((_, i) => generations[i] >= 1);
console.log(`${hardwired.length} hardwired of ${sampled.length} sampled`);

// 2. Character is a pure registry function; group candidates by family.
const families = await inChunks(hardwired, 25, id =>
  client.readContract({ address: REGISTRY, abi, functionName: "familyOf", args: [id], blockNumber }));
const byFamily = FAMILIES.map(() => []);
hardwired.forEach((id, i) => byFamily[families[i]].push(id));
byFamily.forEach((ids, f) => console.log(`${FAMILIES[f]}: ${ids.length} candidates`));

// 3. Full traits for up to 12 candidates per family, then greedy pick for scenery/floor/generation spread.
const candidates = [...new Set([...ALWAYS_INCLUDE, ...byFamily.flatMap(ids => ids.slice(0, 24))])];
const traits = new Map();
await inChunks(candidates, 5, async id => {
  const uri = await client.readContract({ address: GENERATIONS, abi, functionName: "tokenURI", args: [id], blockNumber });
  traits.set(id, { tokenId: id, ...parseMetadata(uri) });
});

const picked = ALWAYS_INCLUDE.map(id => traits.get(id));
const count = (key, value) => picked.filter(p => p[key] === value).length;
for (const name of FAMILIES) {
  const pool = candidates.map(id => traits.get(id)).filter(t => t.character === name && !picked.includes(t));
  while (picked.filter(p => p.character === name).length < PER_FAMILY && pool.length) {
    pool.sort((a, b) => (count("scenery", a.scenery) - count("scenery", b.scenery))
      || (count("floor", a.floor) - count("floor", b.floor))
      || (count("generation", a.generation) - count("generation", b.generation))
      || (a.tokenId < b.tokenId ? -1 : 1));
    picked.push(pool.shift());
  }
}

// 4. Canonical 16×16 sprite frames from the registry.
await inChunks(picked, 5, async t => {
  const frames = await client.readContract({ address: REGISTRY, abi, functionName: "frames",
    args: [FAMILIES.indexOf(t.character), t.seed], blockNumber });
  t.frames = frames.map(f => f.toString(16).padStart(64, "0"));
});

picked.sort((a, b) => FAMILIES.indexOf(a.character) - FAMILIES.indexOf(b.character) || (a.tokenId < b.tokenId ? -1 : 1));
const output = {
  source: { chainId: 4663, generations: GENERATIONS, registry: REGISTRY, blockNumber: blockNumber.toString(),
    readAt: new Date().toISOString().slice(0, 10) },
  friends: picked.map(t => ({ ...t, tokenId: t.tokenId.toString() })),
};
await mkdir(new URL("../game/src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../game/src/data/pool.json", import.meta.url), JSON.stringify(output, null, 1) + "\n");
const tally = key => Object.entries(Object.groupBy(picked, p => p[key])).map(([k, v]) => `${k} ${v.length}`).join(", ");
console.log(`Wrote ${picked.length} Friends.\nCharacter: ${tally("character")}\nScenery: ${tally("scenery")}\nFloor: ${tally("floor")}\nGeneration: ${tally("generation")}`);
