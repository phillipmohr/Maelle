/**
 * Deterministic ids for seed data and idempotency keys. Pure JS, no Node dependency, so it works in
 * the browser, in Nitro and in scripts. Not cryptographic.
 */

// BigInt via the constructor (no literals) keeps esbuild quiet for older targets.
const FNV_PRIME = BigInt('0x100000001b3')
const MASK_64 = BigInt('0xffffffffffffffff')
const SEED_A = BigInt('0xcbf29ce484222325')
const SEED_B = BigInt('0x84222325cbf29ce4')

function fnv1a64(input: string, seed: bigint): bigint {
  let hash = seed
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash
}

/** A stable RFC 4122 shaped UUID (version 8 bits set) derived from a name. */
export function deterministicUuid(name: string): string {
  const a = fnv1a64(name, SEED_A)
  const b = fnv1a64(name + '\u0000maelle', SEED_B)
  const hex = a.toString(16).padStart(16, '0') + b.toString(16).padStart(16, '0')
  const chars = hex.split('')
  chars[12] = '8' // version nibble
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16]!, 16) % 4]! // variant
  const s = chars.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

/** Idempotency key for an action execution: ticket + proposal version + position (+ attempt scope). */
export function executionIdempotencyKey(
  ticketId: string,
  proposalVersion: number,
  position: number,
): string {
  return `${ticketId}:v${proposalVersion}:p${position}`
}

/** "#4825" */
export function formatDisplayNumber(n: number): string {
  return `#${n}`
}
