import { describe, it, expect } from "vitest";
import { redact } from "./redact.js";

// Helper: assert the input no longer appears anywhere in the output
function assertRedacted(output: string, secret: string): void {
  expect(output).not.toContain(secret);
  expect(output).toContain("[REDACTED]");
}

describe("redact()", () => {
  // ── AWS keys ──────────────────────────────────────────────────────────────
  describe("AWS credentials", () => {
    it("redacts an AKIA access key ID", () => {
      const text = "Key: AKIAIOSFODNN7EXAMPLE";
      const out = redact(text);
      assertRedacted(out, "AKIAIOSFODNN7EXAMPLE");
    });

    it("redacts an ASIA session key ID", () => {
      const text = "access_key=ASIAIOSFODNN7EXAMPLE";
      const out = redact(text);
      assertRedacted(out, "ASIAIOSFODNN7EXAMPLE");
    });

    it("redacts AWS_SECRET_ACCESS_KEY env-var assignment", () => {
      const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      const text = `AWS_SECRET_ACCESS_KEY=${secret}`;
      const out = redact(text);
      assertRedacted(out, secret);
      // The key name should still be visible
      expect(out).toContain("AWS_SECRET_ACCESS_KEY");
    });
  });

  // ── Bearer tokens ─────────────────────────────────────────────────────────
  describe("Bearer tokens", () => {
    it("redacts Bearer token in Authorization header", () => {
      const token = "eyABC123token.value_here";
      const text = `Authorization: Bearer ${token}`;
      const out = redact(text);
      assertRedacted(out, token);
      expect(out).toContain("Bearer");
    });

    it("redacts bearer token (case-insensitive)", () => {
      const text = "authorization: bearer abc123token";
      const out = redact(text);
      assertRedacted(out, "abc123token");
    });

    it("redacts api_token key-value pair", () => {
      const text = "api_token=s3cr3t-value-here";
      const out = redact(text);
      assertRedacted(out, "s3cr3t-value-here");
    });

    it("redacts access_token key-value pair", () => {
      const text = 'access_token: "tok_abcdef12345"';
      const out = redact(text);
      assertRedacted(out, "tok_abcdef12345");
    });
  });

  // ── Passwords ─────────────────────────────────────────────────────────────
  describe("Passwords", () => {
    it("redacts password= assignment", () => {
      const text = "db_url=postgres://user:password=SuperSecret@host/db";
      const out = redact(text);
      assertRedacted(out, "SuperSecret");
    });

    it("redacts PASSWORD= (case-insensitive)", () => {
      const text = "PASSWORD=hunter2";
      const out = redact(text);
      assertRedacted(out, "hunter2");
    });

    it("redacts passwd= assignment", () => {
      const text = "passwd=p@$$w0rd";
      const out = redact(text);
      assertRedacted(out, "p@$$w0rd");
    });
  });

  // ── JWTs ──────────────────────────────────────────────────────────────────
  describe("JWTs", () => {
    it("redacts a well-formed JWT", () => {
      // Header: {"alg":"HS256"} → eyJhbGciOiJIUzI1NiJ9
      // Payload: {"sub":"1234"} → eyJzdWIiOiIxMjM0In0
      // Signature (fake)
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const text = `token=${jwt}`;
      const out = redact(text);
      assertRedacted(out, jwt);
    });

    it("redacts a JWT embedded in a log line", () => {
      const jwt =
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.abc123def456";
      const text = `2024-01-01 INFO Authenticating with ${jwt}`;
      const out = redact(text);
      assertRedacted(out, jwt);
    });
  });

  // ── Email addresses ───────────────────────────────────────────────────────
  describe("Email addresses", () => {
    it("redacts a plain email address", () => {
      const text = "Deployed by alice@example.com at 14:00";
      const out = redact(text);
      assertRedacted(out, "alice@example.com");
    });

    it("redacts email in a URL-like context", () => {
      const text = "Contact: support+team@corp.io for help";
      const out = redact(text);
      assertRedacted(out, "support+team@corp.io");
    });

    it("does NOT redact plain domain names without @", () => {
      const text = "Server: example.com is healthy";
      const out = redact(text);
      expect(out).toBe(text); // unchanged
    });
  });

  // ── API keys / generic secrets ────────────────────────────────────────────
  describe("Generic API keys and secrets", () => {
    it("redacts x-api-key header value", () => {
      const text = "x-api-key: abc123xyz";
      const out = redact(text);
      assertRedacted(out, "abc123xyz");
    });

    it("redacts api_key= value", () => {
      const text = "curl -H 'api_key=mySecretKey123'";
      const out = redact(text);
      assertRedacted(out, "mySecretKey123");
    });

    it("redacts client_secret value", () => {
      const text = "client_secret=deadbeef1234abcd";
      const out = redact(text);
      assertRedacted(out, "deadbeef1234abcd");
    });

    it("redacts secret_key value", () => {
      const text = "secret_key: mySuperSecretKey";
      const out = redact(text);
      assertRedacted(out, "mySuperSecretKey");
    });
  });

  // ── No-op cases ───────────────────────────────────────────────────────────
  describe("No-op cases", () => {
    it("leaves clean text unchanged", () => {
      const text = "Service payment-svc restarted after OOMKilled at 2024-01-01T12:00:00Z";
      expect(redact(text)).toBe(text);
    });

    it("returns an empty string unchanged", () => {
      expect(redact("")).toBe("");
    });
  });

  // ── Multiple secrets in one string ────────────────────────────────────────
  describe("Multiple secrets in one string", () => {
    it("redacts all occurrences of the same pattern", () => {
      const text =
        "Email alice@example.com and bob@example.com for support";
      const out = redact(text);
      expect(out).not.toContain("alice@example.com");
      expect(out).not.toContain("bob@example.com");
    });

    it("redacts multiple different secret types in the same string", () => {
      const key = "AKIAIOSFODNN7EXAMPLE";
      const email = "ops@example.com";
      const text = `AWS key: ${key}, contact: ${email}`;
      const out = redact(text);
      expect(out).not.toContain(key);
      expect(out).not.toContain(email);
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────
  describe("Idempotency", () => {
    it("is idempotent: redacting already-redacted text returns same string", () => {
      const text = "api_key=secret123";
      const once = redact(text);
      const twice = redact(once);
      expect(twice).toBe(once);
    });
  });
});
