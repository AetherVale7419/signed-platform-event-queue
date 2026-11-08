import assert from "node:assert/strict";
import test from "node:test";
import { decideDiagnostic, parseDeveloperDiagnostic, parsePlatformEvent } from "../src/platform_events.js";
import { signBody, verifySignature } from "../src/signature.js";

test("a signed failed image job becomes an actionable error diagnostic", () => {
  const secret = "local-test-secret";
  const body = Buffer.from(JSON.stringify({
    id: "evt_build_41",
    type: "image.job.failed",
    project_id: "creator-studio",
    occurred_at: "2026-09-18T09:30:00.000Z",
    build_id: "build_41",
    status: "failed",
    commit_sha: "d4510ad"
  }));

  assert.equal(verifySignature(body, `sha256=${signBody(body, secret)}`, secret), true);
  const diagnostic = decideDiagnostic(parsePlatformEvent(JSON.parse(body.toString("utf8"))));
  assert.deepEqual(
    { severity: diagnostic.severity, state: diagnostic.state, event_id: diagnostic.event_id },
    { severity: "error", state: "job_failed", event_id: "evt_build_41" }
  );
});

test("a completed batch becomes an informational diagnostic", () => {
  const event = parsePlatformEvent({
    id: "evt_release_12",
    type: "ai.batch.completed",
    project_id: "creator-studio",
    occurred_at: "2026-09-18T10:00:00.000Z",
    release_id: "rel_12",
    version: "2.4.0",
    channel: "production"
  });

  assert.equal(decideDiagnostic(event).state, "job_completed");
});

test("developer diagnostics accept direct and wrapped deliveries and reject invalid payloads", () => {
  const diagnostic = decideDiagnostic(parsePlatformEvent({
    id: "evt_release_13",
    type: "ai.batch.completed",
    project_id: "creator-studio",
    occurred_at: "2026-09-18T10:00:00.000Z",
    release_id: "rel_13",
    version: "2.4.1",
    channel: "production"
  }));

  assert.deepEqual(parseDeveloperDiagnostic(diagnostic), diagnostic);
  assert.deepEqual(parseDeveloperDiagnostic({ payload: diagnostic }), diagnostic);
  assert.throws(() => parseDeveloperDiagnostic({ payload: { ...diagnostic, state: "invalid" } }));
  assert.throws(() => parseDeveloperDiagnostic({}));
});

 test("unsupported build events are rejected and all subscribed events are accepted", () => {
  assert.throws(() => parsePlatformEvent({ id: "evt", type: "build.completed" }));
  for (const type of ["image.job.completed", "image.job.failed", "ai.batch.completed", "ai.batch.failed"]) {
    const event = parsePlatformEvent({ id: "evt", type, data: { job_id: "job" } });
    assert.deepEqual(event.data, { job_id: "job" });
    assert.equal(decideDiagnostic(event).severity, type.endsWith(".failed") ? "error" : "info");
  }
});
