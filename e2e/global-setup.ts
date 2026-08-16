const FUNCTIONS_HEALTH = 'http://127.0.0.1:5001/life-tracker-test/europe-west1/lifeTrackerAiApi/v1/health';
const ALLOWED_ORIGIN = 'http://127.0.0.1:3100';
const WARMUP_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 90_000;

export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_USE_FUNCTIONS_EMULATOR !== 'true') return;
  const deadline = Date.now() + WARMUP_TIMEOUT_MS;
  let lastStatus = 'not reached';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(FUNCTIONS_HEALTH, {
        headers: { Origin: ALLOWED_ORIGIN },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) {
        const body = await response.json() as { status?: unknown };
        if (body.status === 'ok') return;
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : 'unknown warmup error';
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Functions emulator did not become ready within ${WARMUP_TIMEOUT_MS}ms (${lastStatus}).`);
}
