/**
 * PKCE (RFC 7636) and state helpers. The hosted authorization server only
 * accepts the S256 method and a 43-character base64url challenge.
 */

import { createHash, randomBytes } from "crypto";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** A 43-character verifier (32 random bytes), well inside RFC 7636's 43-128. */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** BASE64URL(SHA256(verifier)), always 43 characters. */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

/** Opaque anti-CSRF value echoed back on the loopback redirect. */
export function generateState(): string {
  return base64url(randomBytes(24));
}
