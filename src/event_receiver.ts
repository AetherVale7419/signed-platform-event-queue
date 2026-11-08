import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { decideDiagnostic, parseDeveloperDiagnostic, parsePlatformEvent } from "./platform_events.js";
import { verifySignature } from "./signature.js";

const apiKey = process.env.INFRAI_API_KEY;
const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
const queueName = process.env.INFRAI_QUEUE ?? "creator-platform-events";
const port = Number(process.env.PORT ?? "3000");

if (!apiKey || !webhookSecret) throw new Error("INFRAI_API_KEY and WEBHOOK_SECRET are required");
const infrai = new InfraiClient(apiKey);

async function rawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const isWebhook = request.method === "POST" && request.url === "/events/platform";
  const isQueuePush = request.method === "POST" && request.url === "/queue/diagnostics";
  if (!isWebhook && !isQueuePush) {
    json(response, 404, { error: "route_not_found" });
    return;
  }

  const body = await rawBody(request);
  if (!verifySignature(body, request.headers["x-infrai-signature"] as string | undefined, webhookSecret)) {
    json(response, 401, { error: "invalid_signature" });
    return;
  }

  try {
    if (isQueuePush) {
      const diagnostic = parseDeveloperDiagnostic(JSON.parse(body.toString("utf8")));
      console.log(JSON.stringify({
        event_id: diagnostic.event_id,
        state: diagnostic.state,
        summary: diagnostic.summary
      }));
      json(response, 200, { consumed: true, event_id: diagnostic.event_id });
      return;
    }

    const event = parsePlatformEvent(JSON.parse(body.toString("utf8")));
    const diagnostic = decideDiagnostic(event);
    await infrai.request(`/v1/queue/publish`, "POST", {
      queue: queueName,
      payload: diagnostic,
      idempotency_key: event.id
    });
    json(response, 202, { accepted: true, event_id: event.id, state: diagnostic.state });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      json(response, 400, { error: "invalid_event" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      json(response, status, { error: error.code });
      return;
    }
    json(response, 502, { error: "delivery_failed" });
  }
}

createServer((request, response) => {
  receive(request, response).catch(() => json(response, 500, { error: "receiver_failed" }));
}).listen(port, () => {
  console.log(`Platform event receiver listening on http://localhost:${port}`);
});
