// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * /admin/api-explorer is a developer page. The page itself -- a Server
 * Component -- decides who sees it: a Clerk user id listed in
 * DEVELOPER_USER_IDS gets the explorer, and for everyone else the page is
 * notFound(), exactly as if the route were not in the build.
 *
 * notFound() is the real one from next/navigation. The page is awaited and
 * its result rendered, which is how a Server Component is driven outside
 * Next: an async component cannot be handed to render() directly.
 *
 * require-auth.ts is mocked because the real module imports "server-only",
 * which throws outside a Server Component.
 */

const getUserId = vi.fn();
vi.mock("@/lib/auth/require-auth", () => ({ getUserId: () => getUserId() }));

vi.mock("@/components/layout/BreadcrumbSetter", () => ({
  BreadcrumbSetter: () => null,
}));

const { default: ApiExplorerPage } = await import("./page");

const DEVELOPER = "user_2abcDEF";
const SOMEONE_ELSE = "user_2zzzZZZ";

/** The digest Next's notFound() throws; see next/dist/docs, functions/not-found. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

async function renderPage() {
  render(await ApiExplorerPage());
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("/admin/api-explorer", () => {
  it("is not found for a signed-in person who is not on the list", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(SOMEONE_ELSE);

    await expect(renderPage()).rejects.toMatchObject(NOT_FOUND);
    expect(screen.queryByText("API Explorer")).toBeNull();
  });

  it("is not found for every signed-in person when the list is unset", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", undefined);
    getUserId.mockResolvedValue(DEVELOPER);

    await expect(renderPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("is not found when nobody is signed in", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(null);

    await expect(renderPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("renders the explorer for a listed developer", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(DEVELOPER);

    await renderPage();

    expect(screen.getByText("API Explorer")).toBeTruthy();
    expect(screen.getByText("/api/test-reminders")).toBeTruthy();
  });
});
