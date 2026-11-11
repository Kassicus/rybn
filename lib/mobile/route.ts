import type { z } from "zod";

/**
 * Shared plumbing for /api/mobile/v1. Every mobile route is built with
 * `createMobileRoute` so they all check the app's build, sign-in, query and
 * body the same way, and fail with the one error shape the app decodes. This
 * file imports nothing from Next.js, Clerk or Supabase so tests can drive it
 * directly.
 */

export type MobileErrorCode = "unauthorized" | "not_found" | "invalid" | "upgrade_required" | "server_error";

const STATUS: Record<MobileErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  invalid: 422,
  upgrade_required: 426,
  server_error: 500,
};

const MESSAGE: Record<MobileErrorCode, string> = {
  unauthorized: "Please sign in again.",
  not_found: "That isn't there any more.",
  invalid: "That request wasn't valid.",
  upgrade_required: "This version of Rybn is out of date. Please update it.",
  server_error: "Something went wrong. Please try again.",
};

export function mobileError(code: MobileErrorCode, message: string = MESSAGE[code]): Response {
  return Response.json({ error: { code, message } }, { status: STATUS[code] });
}

export interface MobileContext<B, Q> {
  userId: string;
  body: B;
  query: Q;
  params: Record<string, string>;
  request: Request;
}

export interface MobileRouteDeps {
  /** The signed-in person's Clerk id, or null when nobody is signed in. */
  identify: () => Promise<string | null>;
  minBuild: () => number | null;
}

interface RouteContext {
  params: Promise<Record<string, string>>;
}

export function parseMinBuild(value: string | undefined): number | null {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

function appBuild(request: Request): number {
  const n = Number.parseInt(request.headers.get("x-app-build") ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

/** 422 naming the first thing wrong, e.g. "page: Too small: expected number to be >=1". */
function invalid(error: z.ZodError, part: "query" | "body"): Response {
  const issue = error.issues[0];
  return mobileError("invalid", issue ? `${issue.path.join(".") || part}: ${issue.message}` : undefined);
}

export function createMobileRoute(deps: MobileRouteDeps) {
  return function mobileRoute<B = undefined, Q = undefined>(
    handler: (ctx: MobileContext<B, Q>) => Promise<unknown>,
    options: {
      /** Any zod schema; B is its output, so coercions and transforms are fine. */
      body?: z.ZodType<B, unknown>;
      /** Checked against the URL's search parameters, each a string. A repeated one keeps its last value. */
      query?: z.ZodType<Q, unknown>;
    } = {}
  ) {
    const answer = async function (request: Request, context: RouteContext): Promise<Response> {
      try {
        const min = deps.minBuild();
        if (min !== null && appBuild(request) < min) return mobileError("upgrade_required");

        const userId = await deps.identify();
        if (userId === null) return mobileError("unauthorized");

        let query = undefined as Q;
        if (options.query) {
          const parsed = options.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
          if (!parsed.success) return invalid(parsed.error, "query");
          query = parsed.data;
        }

        let body = undefined as B;
        if (options.body) {
          const raw: unknown = await request.json().catch(() => undefined);
          const parsed = options.body.safeParse(raw);
          if (!parsed.success) return invalid(parsed.error, "body");
          body = parsed.data;
        }

        const params = (await context.params) ?? {};
        const result = await handler({ userId, body, query, params, request });
        // A handler may answer with its own Response, e.g. a 422 for an action the website refused.
        if (result instanceof Response) return result;
        return result == null ? new Response(null, { status: 204 }) : Response.json(result);
      } catch (error) {
        console.error(`[mobile] ${new URL(request.url).pathname} failed:`, error);
        return mobileError("server_error");
      }
    };

    // People's wishlists and claims are private, so nothing from here may sit in a phone's URL cache.
    return async function (request: Request, context: RouteContext): Promise<Response> {
      const response = await answer(request, context);
      try {
        response.headers.set("Cache-Control", "no-store");
        return response;
      } catch {
        // A handler's own Response can have immutable headers (e.g. a redirect); copy it to set one.
        const copy = new Response(response.body, response);
        copy.headers.set("Cache-Control", "no-store");
        return copy;
      }
    };
  };
}
