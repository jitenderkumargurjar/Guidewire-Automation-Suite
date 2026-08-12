// Sample/test values for the Automated Bill pay plans' in-page ACH collection flow (see
// QuotePage.enterACHDetailsOnPayPlan). Generic test payment instruments, not real ones - never
// use in a production billing environment.
//
// Credit Card has no equivalent constants here: the sandbox's generic test card (4111...) fills
// and validates fine but is reliably declined by the gateway's real Submit and Pay step, so
// Credit Card on Automated Bill plans is a manual hand-off (see CreatePolicies.spec.ts) until a
// test card the gateway actually approves is available.

// Any of these standard ACH test routing numbers works; rotated per row for variety.
const TEST_ACH_ROUTING_NUMBERS = ['021000021', '011401533', '091000019'];

export function randomTestRoutingNumber(): string {
  return TEST_ACH_ROUTING_NUMBERS[Math.floor(Math.random() * TEST_ACH_ROUTING_NUMBERS.length)];
}

// The gateway accepts any 3-17 digit account number; 9 digits keeps it realistic without meaning
// anything. Randomized per run like the vehicle odometer, to avoid reusing the same number.
export function randomTestAccountNumber(): string {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}
