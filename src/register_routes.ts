import { randomBytes, randomUUID } from "node:crypto";
import { platformEventTypes } from "./platform_events.js";
import { InfraiClient } from "./infrai_client.js";

const apiKey = process.env.INFRAI_API_KEY;
const publicUrl = process.env.PUBLIC_BASE_URL;
const queueName = process.env.INFRAI_QUEUE ?? "creator-platform-events";
const secret = process.env.WEBHOOK_SECRET ?? randomBytes(32).toString("hex");

if (!apiKey || !publicUrl) throw new Error("INFRAI_API_KEY and PUBLIC_BASE_URL are required");

const infrai = new InfraiClient(apiKey);
const webhookUrl = new URL("/events/platform", publicUrl).toString();
const queuePushUrl = new URL("/queue/diagnostics", publicUrl).toString();

const webhook = await infrai.request("/v1/account/webhooks/register", "POST", {
  url: webhookUrl,
  events: [...platformEventTypes],
  secret,
  idempotency_key: `platform-webhook-${randomUUID()}`
});
console.log(JSON.stringify({ webhook }));

await infrai.request(`/v1/queue/push_subscribe/${encodeURIComponent(queueName)}`, "POST", {
  queue: queueName,
  url: queuePushUrl,
  secret,
  visibility_timeout: 60,
  max_retries: 5,
  idempotency_key: `platform-push-${randomUUID()}`
});

console.log(JSON.stringify({ webhook_url: webhookUrl, queue_push_url: queuePushUrl, queue: queueName, secret }, null, 2));
