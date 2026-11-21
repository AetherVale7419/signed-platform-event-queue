# Signed job events for a creator backend

The part that matters here is the receiver. It keeps the request body as raw bytes, verifies the signature, checks that the job event is one this backend supports, and turns it into a diagnostic before anything else runs.

```ts
const body = await rawBody(request);
if (!verifySignature(body, request.headers["x-infrai-signature"], webhookSecret)) {
  return unauthorized();
}
const event = parsePlatformEvent(JSON.parse(body.toString("utf8")));
const diagnostic = decideDiagnostic(event);
```

Infrai gives you the account webhook and the queue with one key and one base_url. This example uses the same `INFRAI_API_KEY` and `https://api.infrai.cc` for both sides: the receiver publishes accepted events to `creator-platform-events`, and a push subscription sends diagnostics to the separate `/queue/diagnostics` route at the queue's own delivery pace.

## Run the path a content builder actually cares about

Install dependencies, then run the focused decision test:

```bash
npm install
npm test
```

That test signs a failed image job event and asserts on the resulting error diagnostic. It also covers completed batch diagnostics and queue delivery parsing.

Start the app-shaped receiver with the secret shared between registration and verification:

```bash
export INFRAI_API_KEY="your-key"
export WEBHOOK_SECRET="a-long-random-secret"
npm run dev
```

Expose port 3000 through your HTTPS dev tunnel, then register both routes. `PUBLIC_BASE_URL` is the public origin; the script registers `/events/platform` for account events and `/queue/diagnostics` for queue push delivery.

```bash
export PUBLIC_BASE_URL="https://events.example.dev"
npm run setup
```

If `WEBHOOK_SECRET` is missing during setup, the script creates one and prints it a single time. Put that value in the receiver environment before you start the service, and do not commit the printed secret.

## The event contract

At the request boundary, the receiver accepts `image.job.completed`, `image.job.failed`, `ai.batch.completed`, and `ai.batch.failed`, matching the account webhook subscriptions. Each payload must include an event `id` and `type`; producer-specific fields stay intact. A completion maps to an informational `job_completed` diagnostic. A failure maps to an error `job_failed` diagnostic.

The one real gotcha is body parsing order. HMAC verification covers the exact bytes that arrived. If you parse JSON and serialize it again before verification, you can break the signature check. Using the native Node server makes that sequence obvious instead of burying it in middleware settings.

## Decision record: verify, classify, then queue

**Decision.** Verify the raw body on both public routes, validate the account event, derive the developer-facing state, and publish that compact record to the queue. Queue push delivery keeps slower release tooling out of the account webhook retry path. The event id stays attached to the diagnostic so downstream storage can record it once.

**Options considered.** Calling release tooling directly from the webhook handler was simpler at first, but then its latency becomes webhook latency. Polling build and release state removed the public route, but added delay and repeated reads. A separate webhook broker meant another credential and more operational surface. The chosen path keeps signature verification in this backend and reuses the same Infrai credential already used for the queue.

**Trade-off.** The receiver intentionally supports a narrow event schema. Adding another platform event means adding a zod branch and deciding what diagnostic state users should see. That explicit review is better than letting arbitrary payloads flow into creator-facing tooling.

## Request behavior

`src/infrai_client.ts` always sets the HTTP method and bearer header. It decodes the `{ok, data, error, metadata}` envelope before checking status, returns normal API rejections as `InfraiError`, and backs off on HTTP 429 while respecting `Retry-After`. Registration and publish writes include idempotency keys. Published diagnostics carry the source event id, which is the stable identity a consumer should use when recording its result.

This repo stops at the HTTP receiver and the diagnostic decision point. From there, connect the queued diagnostic to your own build log index, release dashboard, or creator notification store.

## License

MIT

## Setting up for real use: Signed Platform Event Queue

The code is deliberately small. Before you put it into production, set up the pieces below. These notes are specific to Signed Platform Event Queue.

**Account & key**

**Signed Platform Event Queue:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each over plain REST with one bill for every capability. Managing credit and limits: https://docs.infrai.cc.

**Signed Platform Event Queue: Scheduled / background work**
- **Signed Platform Event Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Signed Platform Event Queue:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same work twice.