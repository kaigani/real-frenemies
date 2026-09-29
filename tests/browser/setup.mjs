/** Project-owned setup + real SDK sandbox. Wallet/RPC fixtures exist only in this test. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createGameServer } from "@rarefriends/friendsdk/serve";
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, padHex, parseAbi, zeroAddress } from "viem";
import { FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
const OWNER = "0x1111111111111111111111111111111111111111", OTHER = "0x2222222222222222222222222222222222222222", TBA = "0x3333333333333333333333333333333333333333";
const ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)", "function balanceOf(address account) view returns (uint256)", "function ownerOf(uint256 tokenId) view returns (address)", "function generation(uint256 tokenId) view returns (uint8)", "function tokenBoundAccount(uint256 tokenId) view returns (address)"]);
const fixtureFriend = JSON.parse(await readFile(new URL("../../game/src/data/pool.json", import.meta.url))).friends.find(f => f.tokenId === "7730");
const frames = fixtureFriend.frames.map(value => BigInt(`0x${value}`));
const server = createGameServer("game/.friendsdk");
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
await mkdir("artifacts/setup", { recursive: true });
try {
  for (const width of [1280, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const state = { failure: false, empty: false, staleOwner: false, ownerReads: 0, logs: [] };
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(({ owner }) => {
      const listeners = new Map(); let accounts = [], chain = "0x1237";
      const emit = (event, value) => { for (const listener of listeners.get(event) ?? []) listener(value); };
      window.ethereum = { async request({ method, params }) {
        if (method === "eth_accounts") return accounts;
        if (method === "eth_requestAccounts") { accounts = [owner]; return accounts; }
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") { chain = params[0].chainId; emit("chainChanged", chain); return null; }
        throw new Error(`Forbidden wallet method: ${method}`);
      }, on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); }, removeListener(event, listener) { listeners.get(event)?.delete(listener); } };
      window.walletTest = { accounts(value) { accounts = value; emit("accountsChanged", value); }, chain(value) { chain = value; emit("chainChanged", value); } };
    }, { owner: OWNER });
    await page.route("https://rpc.mainnet.chain.robinhood.com/**", async route => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" } });
      const request = route.request().postDataJSON();
      function answer(req) {
        const response = { jsonrpc: "2.0", id: req.id };
        if (state.failure && req.method === "eth_getLogs") return { ...response, error: { code: -32602, message: "History temporarily unavailable" } };
        let result;
        if (req.method === "eth_chainId") result = "0x1237";
        else if (req.method === "eth_blockNumber") result = "0x484345c";
        else if (req.method === "eth_getLogs") {
          const q = req.params[0], from = BigInt(q.fromBlock), to = BigInt(q.toBlock);
          assert.equal(q.address.toLowerCase(), GENERATION_SPRITE_MANIFEST.generations.toLowerCase());
          assert(q.topics[1] || q.topics[2], "Every query must be owner-filtered");
          state.logs.push([from, to]);
          if (to - from >= 10_000_000n) return { ...response, error: { code: -32602, message: "query spans too many blocks; narrow the block range" } };
          result = q.topics[1] || from > 16n || to < 16n ? [] : [{ address: GENERATION_SPRITE_MANIFEST.generations, blockNumber: "0x10", blockHash: padHex("0x10", { size: 32 }), transactionHash: padHex("0x1234", { size: 32 }), transactionIndex: "0x0", logIndex: "0x0", removed: false, data: "0x", topics: encodeEventTopics({ abi: ABI, eventName: "Transfer", args: { from: zeroAddress, to: OWNER, tokenId: 7730n } }) }];
        } else if (req.method === "eth_call") {
          const call = req.params[0], art = call.to.toLowerCase() === GENERATION_SPRITE_MANIFEST.registry.toLowerCase(), abi = art ? FAMILIES_REGISTRY_ABI : ABI;
          const { functionName } = decodeFunctionData({ abi, data: call.data }); let value;
          if (art) value = functionName === "familyOf" ? 5 : functionName === "seedOf" ? 7730 : frames;
          else if (functionName === "balanceOf") value = state.empty ? 0n : 1n;
          else if (functionName === "ownerOf") { state.ownerReads++; value = state.staleOwner ? OTHER : OWNER; }
          else if (functionName === "generation") value = 1;
          else if (functionName === "tokenBoundAccount") value = TBA;
          else throw new Error(`Unexpected contract method: ${functionName}`);
          result = encodeFunctionResult({ abi, functionName, result: value });
        } else throw new Error(`Unexpected RPC: ${req.method}`);
        return { ...response, result };
      }
      await route.fulfill({ json: Array.isArray(request) ? request.map(answer) : answer(request), headers: { "access-control-allow-origin": "*" } });
    });
    const shot = async name => page.screenshot({ path: `artifacts/setup/${width}-${name}.png`, fullPage: true });
    await page.goto(origin); await page.getByRole("button", { name: "Connect wallet" }).waitFor(); await shot("connect");
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await page.getByRole("button", { name: /Friend #7730/ }).waitFor(); await shot("choose");
    assert.equal(state.logs.length, 32, "Both directions cover 76 million blocks in bounded windows");
    assert(state.logs.every(([from, to]) => to - from < 5_000_000n));
    await page.getByRole("button", { name: /Friend #7730/ }).click(); await shot("ready");
    await page.getByRole("button", { name: "Start adventure" }).click();
    const game = page.frameLocator("iframe"); await game.getByRole("status").filter({ hasText: "The Lantern Road" }).waitFor();
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
    assert.equal(await game.locator("body").evaluate(() => { try { return Boolean(parent.document); } catch { return false; } }), false);
    assert(state.ownerReads >= 2, "Selected Friend receives fresh SDK ownership verification"); await shot("play");
    await game.getByRole("button", { name: "Territory mode (resets campaign)" }).focus();
    await page.keyboard.press("Enter");
    await game.getByRole("status").filter({ hasText: "Base loaded" }).waitFor();
    const canvas = game.locator("canvas");
    assert.deepEqual(await canvas.evaluate(c => [c.width, c.height]), [640, 480]);
    await canvas.focus(); await page.keyboard.press("Escape");
    await page.waitForTimeout(100); await shot("versus");
    if (width === 360) {
      const deck = game.getByLabel("Versus command deck"), bounds = await deck.boundingBox(), gameBounds = await game.locator(".rf-game").boundingBox();
      assert(bounds.y + bounds.height <= gameBounds.y + gameBounds.height, "Versus touch controls fit inside game");
      assert((await deck.getByRole("button", { name: "Raid", exact: true }).boundingBox()).height >= 44);
      await deck.getByRole("button", { name: "Help", exact: true }).click();
      await deck.getByRole("button", { name: "Confirm", exact: true }).waitFor();
      await deck.getByRole("button", { name: "Back", exact: true }).click();
      await deck.getByRole("button", { name: "Raid", exact: true }).waitFor();
    }
    await game.getByRole("button", { name: "Campaign mode (resets territory)" }).focus();
    await page.keyboard.press("Enter");
    await game.getByRole("status").filter({ hasText: "The Lantern Road" }).waitFor();
    await page.evaluate(other => window.walletTest.accounts([other]), OTHER);
    await page.locator("iframe").waitFor({ state: "detached" });
    await page.getByRole("alert").filter({ hasText: "couldn't finish" }).waitFor();
    await page.evaluate(owner => window.walletTest.accounts([owner]), OWNER);
    await page.getByRole("button", { name: /Friend #7730/ }).waitFor();
    state.failure = true; await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("button", { name: "Retry loading Friends" }).waitFor(); await shot("error");
    await page.getByText("Know your Friend number?").click(); await page.getByLabel("Friend number", { exact: true }).fill("7730");
    state.staleOwner = true; await page.getByRole("button", { name: "Find Friend", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "different wallet" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Start adventure" }).count(), 0);
    state.staleOwner = false; await page.getByRole("button", { name: "Find Friend", exact: true }).click();
    await page.getByRole("button", { name: "Start adventure" }).waitFor(); await shot("manual-recovery");
    state.failure = false; state.empty = true; await page.getByRole("button", { name: "Retry loading Friends" }).click();
    await page.getByText(/No Rare Friends were found/).waitFor(); await shot("empty");
    await page.evaluate(() => window.walletTest.chain("0x1"));
    await page.getByRole("button", { name: "Switch to Robinhood" }).waitFor(); await shot("network");
    await page.getByRole("button", { name: "Switch to Robinhood" }).click();
    await page.getByText(/No Rare Friends were found/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); await page.close();
    console.log(`PASS setup ${width}px: paged history, selection, sandbox launch, account invalidation, error/retry, manual ownership, empty wallet, network switch.`);
  }
  const page = await browser.newPage(); await page.goto(origin); await page.getByText("Open your wallet to begin.").waitFor();
  await page.screenshot({ path: "artifacts/setup/no-wallet.png", fullPage: true }); await page.close();
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
