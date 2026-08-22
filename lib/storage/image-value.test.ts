import { describe, expect, it } from "vitest";
import { resolveStoredImageValue, isOwnedStoragePath } from "@/lib/storage/image-value";

const ME = "user_2aaaaaaaaaaaaaaaaaaaaaaa";
const THEM = "user_2bbbbbbbbbbbbbbbbbbbbbbb";

describe("resolveStoredImageValue", () => {
  it("accepts my own object path", () => {
    const r = resolveStoredImageValue(`${ME}/123-abc.jpg`, ME);
    expect(r).toEqual({ ok: true, value: `${ME}/123-abc.jpg` });
  });

  it("rejects another user's object path", () => {
    const r = resolveStoredImageValue(`${THEM}/123-abc.jpg`, ME);
    expect(r.ok).toBe(false);
  });

  it("rejects traversal out of my folder", () => {
    expect(resolveStoredImageValue(`${ME}/../${THEM}/x.jpg`, ME).ok).toBe(false);
  });

  it("rejects a leading slash", () => {
    expect(resolveStoredImageValue(`/${ME}/x.jpg`, ME).ok).toBe(false);
  });

  it("rejects a folder that merely starts with my id", () => {
    expect(resolveStoredImageValue(`${ME}extra/x.jpg`, ME).ok).toBe(false);
  });

  it("normalises empty forms to null", () => {
    expect(resolveStoredImageValue("", ME)).toEqual({ ok: true, value: null });
    expect(resolveStoredImageValue(null, ME)).toEqual({ ok: true, value: null });
    expect(resolveStoredImageValue(undefined, ME)).toEqual({ ok: true, value: null });
  });

  it("accepts an external https URL", () => {
    const r = resolveStoredImageValue("https://example.com/a.jpg", ME);
    expect(r.ok).toBe(true);
  });

  it("rejects a URL on our own storage host, including a trailing dot", () => {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
    expect(resolveStoredImageValue(`https://${host}/storage/v1/object/sign/x`, ME).ok).toBe(false);
    expect(resolveStoredImageValue(`https://${host}./storage/v1/object/sign/x`, ME).ok).toBe(false);
  });
});

describe("isOwnedStoragePath", () => {
  it("is exact on the folder segment", () => {
    expect(isOwnedStoragePath(`${ME}/x.jpg`, ME)).toBe(true);
    expect(isOwnedStoragePath(`${ME.toUpperCase()}/x.jpg`, ME)).toBe(false);
  });
});
