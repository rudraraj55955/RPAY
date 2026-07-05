import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { customFetch, ApiError } from "./custom-fetch";

describe("customFetch — safe HTML/502 error handling", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, statusText: string, contentType: string, body: string) {
    globalThis.fetch = (async () =>
      new Response(body, {
        status,
        statusText,
        headers: { "content-type": contentType },
      })) as typeof fetch;
  }

  it("never dumps raw HTML into the error message for a proxy 502 page", async () => {
    mockFetch(
      502,
      "Bad Gateway",
      "text/html",
      "<html><head><title>502 Bad Gateway</title></head><body><center>nginx</center></body></html>",
    );

    await assert.rejects(
      () => customFetch("/api/whatever"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 502);
        // The raw markup must never leak into the message shown to the user.
        assert.equal(/<html|<body|<head/i.test(err.message), false);
        assert.match(err.message, /temporarily unavailable/i);
        return true;
      },
    );
  });

  it("gives a generic friendly message for a non-gateway HTML error page", async () => {
    mockFetch(500, "Internal Server Error", "text/html", "<!DOCTYPE html><html><body>Crash</body></html>");

    await assert.rejects(
      () => customFetch("/api/whatever"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(/<html|<body|<!doctype/i.test(err.message), false);
        assert.match(err.message, /unexpected response/i);
        return true;
      },
    );
  });

  it("still preserves the raw HTML on error.data for debugging/logging", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    mockFetch(502, "Bad Gateway", "text/html", html);

    await assert.rejects(
      () => customFetch("/api/whatever"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.data, html);
        return true;
      },
    );
  });

  it("does not treat a normal JSON error body as HTML", async () => {
    mockFetch(400, "Bad Request", "application/json", JSON.stringify({ error: "Email and password required" }));

    await assert.rejects(
      () => customFetch("/api/auth/login"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.match(err.message, /Email and password required/);
        return true;
      },
    );
  });

  it("resolves successfully for a normal 2xx JSON response", async () => {
    mockFetch(200, "OK", "application/json", JSON.stringify({ ok: true }));
    const data = await customFetch<{ ok: boolean }>("/api/health");
    assert.equal(data.ok, true);
  });
});
