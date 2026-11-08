import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(rawBody: Buffer, supplied: string | undefined, secret: string): boolean {
  if (!supplied) return false;
  const expected = Buffer.from(signBody(rawBody, secret), "hex");
  const received = Buffer.from(supplied.replace(/^sha256=/, ""), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
