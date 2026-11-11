import { describe, it, expect } from "vitest";
import { isOwnedStoragePath } from "@/lib/storage/image-value";
import { PICTURE_MAX_BYTES, PICTURE_RULES, checkPicture, picturePath } from "./picture";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const sized = (n: number) => {
  const b = new Uint8Array(n);
  b.set(JPEG);
  return b;
};

describe("checkPicture", () => {
  it("accepts a JPEG and a PNG", () => {
    expect(checkPicture("image/jpeg", JPEG)).toEqual({ ok: true, contentType: "image/jpeg", extension: "jpg" });
    expect(checkPicture("image/png", PNG)).toEqual({ ok: true, contentType: "image/png", extension: "png" });
  });
  it("ignores parameters and case in the Content-Type", () => {
    expect(checkPicture(" Image/JPEG ; charset=binary", JPEG).ok).toBe(true);
  });
  it("refuses any other type", () => {
    for (const t of ["image/gif", "image/webp", "application/octet-stream", null]) {
      expect(checkPicture(t, JPEG)).toEqual({ ok: false, message: PICTURE_RULES.type });
    }
  });
  it("refuses more than 4 MB and accepts exactly 4 MB", () => {
    expect(checkPicture("image/jpeg", sized(PICTURE_MAX_BYTES + 1))).toEqual({ ok: false, message: PICTURE_RULES.size });
    expect(checkPicture("image/jpeg", sized(PICTURE_MAX_BYTES)).ok).toBe(true);
  });
  it("refuses bytes that don't start like the type", () => {
    expect(checkPicture("image/png", JPEG)).toEqual({ ok: false, message: PICTURE_RULES.bytes });
    expect(checkPicture("image/jpeg", new Uint8Array())).toEqual({ ok: false, message: PICTURE_RULES.bytes });
  });
});

describe("picturePath", () => {
  it("puts the picture in the caller's own folder", () => {
    const path = picturePath("user_2abcDEF", "jpg", 1794400000000, "k3j2");
    expect(path).toBe("user_2abcDEF/1794400000000-k3j2.jpg");
    expect(isOwnedStoragePath(path, "user_2abcDEF")).toBe(true);
  });
});
