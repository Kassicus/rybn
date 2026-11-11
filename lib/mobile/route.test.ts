import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { createMobileRoute, parseMinBuild, type MobileRouteDeps } from "./route";

const errorFixture = JSON.parse(readFileSync("lib/mobile/fixtures/error.json", "utf8"));

const noParams = { params: Promise.resolve({}) };

function request(init: { build?: string; body?: unknown; search?: string } = {}): Request {
  const headers = new Headers();
  if (init.build !== undefined) headers.set("x-app-build", init.build);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost/api/mobile/v1/thing${init.search ?? ""}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function route(deps: Partial<MobileRouteDeps> = {}) {
  return createMobileRoute({ identify: async () => "user_1", minBuild: () => null, ...deps });
}

describe("mobileRoute", () => {
  it("passes the signed-in user id to the handler and returns its JSON", async () => {
    const GET = route()(async ({ userId }) => ({ id: userId }));
    const res = await GET(request({ build: "1" }), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "user_1" });
  });

  it("marks every answer no-store", async () => {
    const ok = route()(async () => ({ ok: true }));
    expect((await ok(request({ build: "1" }), noParams)).headers.get("cache-control")).toBe("no-store");
    const empty = route()(async () => null);
    expect((await empty(request({ build: "1", body: {} }), noParams)).headers.get("cache-control")).toBe("no-store");
    const own = route()(async () => new Response("teapot", { status: 418 }));
    expect((await own(request({ build: "1" }), noParams)).headers.get("cache-control")).toBe("no-store");
    const frozen = route()(async () => Response.redirect("http://localhost/elsewhere", 302));
    expect((await frozen(request({ build: "1" }), noParams)).headers.get("cache-control")).toBe("no-store");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = route()(async () => {
      throw new Error("boom");
    });
    expect((await failing(request({ build: "1" }), noParams)).headers.get("cache-control")).toBe("no-store");
    spy.mockRestore();
    const old = route({ minBuild: () => 5 })(async () => ({}));
    expect((await old(request({ build: "1" }), noParams)).headers.get("cache-control")).toBe("no-store");
    const out = route({ identify: async () => null })(async () => ({}));
    expect((await out(request({ build: "1" }), noParams)).headers.get("cache-control")).toBe("no-store");
  });

  it("answers 204 with no body when the handler returns nothing", async () => {
    const POST = route()(async () => null);
    const res = await POST(request({ build: "1", body: {} }), noParams);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("hands dynamic route params to the handler", async () => {
    const GET = route()(async ({ params }) => ({ id: params.id }));
    const res = await GET(request({ build: "1" }), { params: Promise.resolve({ id: "abc" }) });
    expect(await res.json()).toEqual({ id: "abc" });
  });

  it("answers 426 when the build is missing or below the minimum", async () => {
    const GET = route({ minBuild: () => 5 })(async () => ({}));
    for (const build of [undefined, "4", "abc"]) {
      const res = await GET(request({ build }), noParams);
      expect(res.status).toBe(426);
      expect((await res.json()).error.code).toBe("upgrade_required");
    }
    expect((await GET(request({ build: "5" }), noParams)).status).toBe(200);
  });

  it("never checks the build when no minimum is set", async () => {
    const GET = route()(async () => ({}));
    expect((await GET(request({}), noParams)).status).toBe(200);
    expect((await GET(request({ build: "abc" }), noParams)).status).toBe(200);
  });

  it("answers 401 in the envelope when nobody is signed in", async () => {
    const GET = route({ identify: async () => null })(async () => ({}));
    const res = await GET(request({ build: "1" }), noParams);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(errorFixture);
  });

  it("checks the build, then sign-in, then the query, then the body", async () => {
    const options = { query: z.object({ week: z.string() }), body: z.object({ name: z.string() }) };
    const lowAndOut = route({ minBuild: () => 5, identify: async () => null })(async () => ({}), options);
    expect((await lowAndOut(request({ build: "1", body: {} }), noParams)).status).toBe(426);
    const out = route({ identify: async () => null })(async () => ({}), options);
    expect((await out(request({ build: "1", body: {} }), noParams)).status).toBe(401);
    const bad = route()(async () => ({}), options);
    const res = await bad(request({ build: "1", body: {} }), noParams);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/^week:/);
  });

  it("answers 422 naming the first problem in the query", async () => {
    const GET = route()(async () => ({}), { query: z.object({ page: z.coerce.number().int().min(1) }) });
    const res = await GET(request({ build: "1", search: "?page=0" }), noParams);
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("invalid");
    expect(error.message.startsWith("page:")).toBe(true);
  });

  it("answers 422 for a body that is not JSON or does not match", async () => {
    const POST = route()(async () => ({}), { body: z.object({ name: z.string() }) });
    const notJson = new Request("http://localhost/api/mobile/v1/thing", {
      method: "POST",
      headers: { "x-app-build": "1" },
      body: "not json",
    });
    expect((await POST(notJson, noParams)).status).toBe(422);
    const wrong = await POST(request({ build: "1", body: { name: 5 } }), noParams);
    expect(wrong.status).toBe(422);
    expect((await wrong.json()).error.code).toBe("invalid");
  });

  it("hands the parsed query and body to the handler", async () => {
    const POST = route()(async ({ query, body }) => ({ page: query.page, name: body.name }), {
      query: z.object({ page: z.coerce.number() }),
      body: z.object({ name: z.string() }),
    });
    const res = await POST(request({ build: "1", search: "?page=2", body: { name: "Jane" } }), noParams);
    expect(await res.json()).toEqual({ page: 2, name: "Jane" });
  });

  it("answers 500 with the generic message and logs the path when the handler throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const GET = route()(async () => {
      throw new Error('relation "x" does not exist');
    });
    const res = await GET(request({ build: "1" }), noParams);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "server_error", message: "Something went wrong. Please try again." },
    });
    expect(text).not.toContain("relation");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/thing"), expect.anything());
    spy.mockRestore();
  });

  it("answers 500, not 401, when identifying the caller throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const GET = route({
      identify: async () => {
        throw new Error("Auth service unavailable");
      },
    })(async () => ({}));
    const res = await GET(request({ build: "1" }), noParams);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
    spy.mockRestore();
  });
});

describe("parseMinBuild", () => {
  it("is null when unset or not a number", () => {
    expect(parseMinBuild(undefined)).toBeNull();
    expect(parseMinBuild("")).toBeNull();
    expect(parseMinBuild("abc")).toBeNull();
  });

  it("reads a whole number", () => {
    expect(parseMinBuild("12")).toBe(12);
  });
});
