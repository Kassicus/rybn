import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/apple-app-site-association", () => {
  it("answers the association as JSON with no sign-in and no redirect", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({
      applinks: { details: [{ appIDs: ["364X389QMX.app.rybn.ios"], components: [{ "/": "/accept-invite" }] }] },
    });
  });

  it("names the app and the one path, and nothing else", async () => {
    const res = await GET();
    expect(await res.text()).toBe(
      '{"applinks":{"details":[{"appIDs":["364X389QMX.app.rybn.ios"],"components":[{"/":"/accept-invite"}]}]}}',
    );
  });
});
