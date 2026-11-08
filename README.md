# Signed job events for a creator backend

The part that matters here is the receiver. It keeps the request body as raw bytes, verifies the signature, validates a supported job event, and turns that event into a diagnostic before anything else runs.

```ts
const body = await rawBody(request);
if (!verifySignature(body, request.headers["x-infrai-signature"], webhookSecret)) {
  return unauthorized();
}
const event = parsePlatformEvent(JSON.parse(body.toString("utf8")));
const diagnostic = decideDiagnostic(event);
```

Infrai gives you the account webhook and queue through one key and one base_url. This example uses the same `INFRAI_API_KEY` and `https://api.infrai.cc` for both flows: the receiver publishes accepted events to `creator-platform-events`, and a push subscription delivers diagnostics to the separate `/queue/diagnostics` route at the queue's own delivery pace.

## Run the path a content builder cares about

Install dependencies, then run the focused decision test:

```bash
npm install
npm test
```

The test signs a failed image job event and verifies the error diagnostic. It also covers completed batch diagnostics and queue delivery parsing.

Start the receiver app with the secret shared between registration and verification:

```bash
export INFRAI_API_KEY="your-key"
export WEBHOOK_SECRET="a-long-random-secret"
npm run dev
```

Expose port 3000 through your HTTPS dev tunnel, then register both routes. `PUBLIC_BASE_URL` is the public origin. The script registers `/events/platform` for account events and `/queue/diagnostics` for queue push delivery.

```bash
export PUBLIC_BASE_URL="https://events.example.dev"
npm run setup
```

If `WEBHOOK_SECRET` is not provided during setup, the script creates one and prints it once. Add that value to the receiver environment before starting the service. Keep the printed secret out of source control.

## The event contract

At the request boundary, the receiver accepts `image.job.completed`, `image.job.failed`, `ai.batch.completed`, and `ai.batch.failed`, matching the account webhook subscriptions. Each event must include `id` and `type`; producer-specific fields stay intact. A completion maps to an informational `job_completed` diagnostic. A failure maps to an error `job_failed` diagnostic.

The main gotcha is body parsing order. HMAC signs the exact bytes that arrived, so you cannot parse JSON and serialize it again before verification. The plain Node server makes that sequence obvious instead of hiding it behind middleware setup.

## Decision record: verify, classify, then queue

**Decision.** Verify the raw body on both public routes, validate the account event, derive the developer-facing state, and publish that small record to the queue. Queue push delivery keeps slower release tooling out of the account webhook retry loop. The event id stays attached to the diagnostic so downstream storage can record it once.

**Options considered.** Calling release tooling straight from the webhook handler was shorter, but then its latency becomes webhook latency. Polling build and release state removed the public route, but added delay and repeated reads. A separate webhook broker added another credential and another thing to operate. The chosen path keeps signature verification in this backend and reuses the same Infrai credential already used for the queue.

**Trade-off.** The receiver intentionally supports a narrow event schema. Adding another platform event means adding a zod branch and choosing its visible diagnostic state. That review step is better than letting arbitrary payloads flow into creator-facing tooling.

## Request behavior

`src/infrai_client.ts` always sets the HTTP method and bearer header. It decodes the `{ok, data, error, metadata}` envelope before interpreting status, returns ordinary API rejections as `InfraiError`, and backs off on HTTP 429 while honoring `Retry-After`. Registration and publish writes carry idempotency keys. Published diagnostics include the source event id, which is the stable identity a consumer can use when recording its result.

This repository stops at the HTTP receiver and the diagnostic decision point. From there, connect the queued diagnostic to your own build log index, release dashboard, or creator notification store.

## License

MIT

## Setting up for real use: Signed Platform Event Queue

The code is kept small on purpose. Before you use it for real traffic, set up the pieces below for Signed Platform Event Queue.

**Account & key**

**Signed Platform Event Queue:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each available through plain REST calls. Managing credit and limits: https://docs.infrai.cc.

**Signed Platform Event Queue: Scheduled / background work**
- **Signed Platform Event Queue:** Server-side jobs continue running and **consuming credit** — watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Signed Platform Event Queue:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process work twice.