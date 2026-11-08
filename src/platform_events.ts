import { z } from "zod";

export const platformEventTypes = [
  "image.job.completed", "image.job.failed", "ai.batch.completed", "ai.batch.failed"
] as const;

// Only require event identity and type; job-specific data belongs to the producer.
const platformEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(platformEventTypes)
}).passthrough();

export type PlatformEvent = z.infer<typeof platformEventSchema>;

const developerDiagnosticSchema = z.object({
  event_id: z.string().min(1),
  severity: z.enum(["info", "error"]),
  state: z.enum(["job_completed", "job_failed"]),
  summary: z.string().min(1),
  source: platformEventSchema
});

export type DeveloperDiagnostic = z.infer<typeof developerDiagnosticSchema>;

export function parsePlatformEvent(input: unknown): PlatformEvent {
  return platformEventSchema.parse(input);
}

export function parseDeveloperDiagnostic(input: unknown): DeveloperDiagnostic {
  return z.union([
    developerDiagnosticSchema,
    z.object({ payload: developerDiagnosticSchema }).transform(({ payload }) => payload)
  ]).parse(input);
}

export function decideDiagnostic(event: PlatformEvent): DeveloperDiagnostic {
  const failed = event.type.endsWith(".failed");
  return {
    event_id: event.id,
    severity: failed ? "error" : "info",
    state: failed ? "job_failed" : "job_completed",
    summary: `${event.type}: ${event.id}`,
    source: event
  };
}
