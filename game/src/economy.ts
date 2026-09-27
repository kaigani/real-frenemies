/** Simulated RF ledger and raid settlement. Exact bigint base units (1 RF = 10^18). No chain calls. */
import { CAPTURE_BURN_PERCENT, FEE_BURN_PERCENT, LEVEL_STAKE, LEVEL_TOPUP, raidFee } from "./rules.ts";

export const RF = 10n ** 18n;
export const rf = (whole: number) => BigInt(whole) * RF;

export type LedgerLine = Readonly<{ day: number; label: string; amount: bigint }>;
export type Ledger = { balance: bigint; burned: bigint; treasury: bigint; captured: bigint; lines: LedgerLine[] };

export function createLedger(start: bigint): Ledger {
  return { balance: start, burned: 0n, treasury: 0n, captured: 0n, lines: [] };
}

export function canAfford(ledger: Ledger, amount: bigint) {
  return amount >= 0n && ledger.balance >= amount;
}

export function post(ledger: Ledger, day: number, label: string, amount: bigint) {
  if (amount < 0n && ledger.balance + amount < 0n) throw new Error("Not enough simulated RF.");
  ledger.balance += amount;
  ledger.lines.push(Object.freeze({ day, label, amount }));
  if (ledger.lines.length > 200) ledger.lines.splice(0, ledger.lines.length - 200);
}

export const topUpCost = (nextLevel: number) => rf(LEVEL_TOPUP[nextLevel]);
export const stakeAt = (level: number) => rf(LEVEL_STAKE[level]);
export const feeFor = (attackers: number) => rf(raidFee(attackers));
export const percent = (amount: bigint, pct: bigint) => amount * pct / 100n;

export type StakedPiece = Readonly<{ key: string; stake: bigint; haggle: boolean }>;
export type SettlementInput = Readonly<{
  fee: bigint;
  coreStake: bigint;
  coreDown: boolean;
  defeated: readonly StakedPiece[];
  survivors: readonly StakedPiece[];
}>;
export type Settlement = Readonly<{
  /** RF paid to the raider from captured stakes, after the 10% burn. */
  toAttacker: bigint;
  /** RF the defender's owner gets back or earns: fee share on a failed raid, Haggle halves, reset refunds. */
  toDefender: bigint;
  /** RF the defender's owner permanently loses (captured stakes, gross). */
  defenderLoss: bigint;
  toTreasury: bigint;
  burned: bigint;
  lines: readonly Readonly<{ label: string; amount: bigint; to: "attacker" | "defender" | "burn" | "treasury" }>[];
}>;

/**
 * Settlement rules from the brief:
 * - Every defeated defender pays its cumulative stake to the attacker (Market Haggle: only half; the rest returns).
 * - A raid that downs the Core also takes the Core's stake; the board resets and survivors' stakes return to the owner.
 * - A failed raid's fee (after burn) is split among surviving defenders pro rata; a winning raid's fee goes to the treasury.
 * - 20% of every raid fee and 10% of every captured stake is burned.
 */
export function settle(input: SettlementInput): Settlement {
  const lines: Settlement["lines"][number][] = [];
  let toAttacker = 0n, toDefender = 0n, defenderLoss = 0n, burned = 0n, toTreasury = 0n;
  const capture = (label: string, gross: bigint) => {
    if (gross <= 0n) return;
    const burn = percent(gross, CAPTURE_BURN_PERCENT);
    burned += burn; toAttacker += gross - burn; defenderLoss += gross;
    lines.push({ label, amount: gross - burn, to: "attacker" }, { label: `${label.replace("Took ", "")} 10%`, amount: burn, to: "burn" });
  };
  for (const piece of input.defeated) {
    const taken = piece.haggle ? piece.stake / 2n : piece.stake;
    capture(`Took ${piece.key}`, taken);
    if (piece.stake - taken > 0n) {
      toDefender += piece.stake - taken;
      lines.push({ label: `Haggle ${piece.key}`, amount: piece.stake - taken, to: "defender" });
    }
  }
  if (input.coreDown) capture("Took Core", input.coreStake);
  const feeBurn = percent(input.fee, FEE_BURN_PERCENT), feeRest = input.fee - feeBurn;
  burned += feeBurn;
  lines.push({ label: "Fee 20%", amount: feeBurn, to: "burn" });
  if (input.coreDown) {
    toTreasury += feeRest;
    lines.push({ label: "Fee 80%", amount: feeRest, to: "treasury" });
    for (const piece of input.survivors) {
      toDefender += piece.stake;
      lines.push({ label: `Reset ${piece.key}`, amount: piece.stake, to: "defender" });
    }
  } else {
    toDefender += feeRest;
    const n = input.survivors.length;
    lines.push({ label: n ? `Fee 80% to ${n} survivor${n === 1 ? "" : "s"}` : "Fee 80% to the Core", amount: feeRest, to: "defender" });
  }
  return Object.freeze({ toAttacker, toDefender, defenderLoss, toTreasury, burned, lines: Object.freeze(lines) });
}

/** Pro rata split of an amount by stake; remainders go to the first pieces so the sum is exact. */
export function splitProRata(amount: bigint, stakes: readonly bigint[]) {
  const total = stakes.reduce((a, b) => a + b, 0n);
  if (total === 0n) return stakes.map(() => 0n);
  const shares = stakes.map(s => amount * s / total);
  let rest = amount - shares.reduce((a, b) => a + b, 0n);
  for (let i = 0; rest > 0n; i = (i + 1) % shares.length) { shares[i] += 1n; rest -= 1n; }
  return shares;
}

export function formatRf(amount: bigint, signed = false) {
  const negative = amount < 0n, abs = negative ? -amount : amount;
  const tenths = (abs * 10n + RF / 2n) / RF;
  const text = `${tenths / 10n}.${tenths % 10n}`;
  return `${negative ? "-" : signed && abs > 0n ? "+" : ""}${text}`;
}
