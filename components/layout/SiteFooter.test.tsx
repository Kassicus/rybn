// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { SiteFooter } from "./SiteFooter";

/**
 * The footer every signed-out page ends with: the front page and the support,
 * terms and privacy pages. Its three links are the addresses App Store Connect
 * asks for (a support page, a privacy policy) and the terms beside them, so
 * each must be a real link to that page.
 */
describe("SiteFooter", () => {
  afterEach(cleanup);

  it("links to the support, privacy and terms pages", () => {
    render(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Support", "/support"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ]);
  });

  it("says whose it is", () => {
    render(<SiteFooter />);
    expect(screen.getByText(/Karnyx Labs LLC/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Karnyx Labs" }).getAttribute("href")).toBe(
      "https://karnyxlabs.com",
    );
  });
});
