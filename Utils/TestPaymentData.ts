// Sample/test values for the hosted ACH/Credit Card collection form (see
// QuotePage.enterACHDetails / enterCreditCardDetailsOnPayPlan). Generic test payment
// instruments, not real ones - never use in a production billing environment.

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

// The generic test card every payment sandbox accepts. It fills and validates fine in the hosted
// card form but is reliably declined by this gateway's real Submit and Pay authorization - kept
// as a single fixed constant rather than a rotated pool (like the ACH numbers above) since it's
// the only number confirmed to reach the gateway at all; there's no confirmed-working alternative
// yet. A decline surfaces as an ordinary failed step (see QuotePage.confirmAndSubmitPayment)
// rather than blocking the run.
export const TEST_CREDIT_CARD_NUMBER = '4111111111111111';

// MM/YY a few years out, computed from today rather than hardcoded so the card doesn't start
// looking expired to the form as time passes.
export function testCreditCardExpiration(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String((now.getFullYear() + 3) % 100).padStart(2, '0');
  return `${month}/${year}`;
}
