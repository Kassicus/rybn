// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import Support from "./page";

/**
 * The support page is the address given to the App Store as the app's support
 * page, and where the app's `Report a problem` rows open (at #report). So it
 * must give a way to reach a person, and say how to report content or a
 * person and what happens then.
 */
describe("the support page", () => {
  afterEach(cleanup);

  it("gives the address to write to", () => {
    render(<Support />);
    expect(screen.getByRole("heading", { level: 1, name: "Support" })).toBeTruthy();
    const addresses = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("mailto:support@rybn.app"));
    expect(addresses.length).toBeGreaterThan(0);
  });

  it("has a section for reporting a problem, which the app opens by its id", () => {
    const { container } = render(<Support />);
    const report = container.querySelector("#report");
    expect(report).not.toBeNull();
    const section = within(report as HTMLElement);
    expect(section.getByRole("heading", { name: "Report a problem" })).toBeTruthy();
    // What to send, and what is done with it.
    expect(section.getByText(/the name of the group/i)).toBeTruthy();
    expect(section.getByText(/remove content/i)).toBeTruthy();
    // A report is one tap away: a message already addressed and titled.
    const write = section.getByRole("link", { name: /support@rybn\.app/ });
    expect(write.getAttribute("href")).toBe("mailto:support@rybn.app?subject=Report%20a%20problem");
  });

  it("says how to delete an account, on the site and in the app", () => {
    render(<Support />);
    expect(screen.getByText(/Settings, then Delete account/)).toBeTruthy();
    expect(screen.getByText(/Account, then Delete account/)).toBeTruthy();
  });

  it("links to the terms and the privacy policy", () => {
    render(<Support />);
    // The terms are linked from the report section too: every such link goes to the terms.
    const terms = screen.getAllByRole("link", { name: "Terms of Service" });
    expect(terms.map((link) => link.getAttribute("href"))).toEqual(["/terms", "/terms"]);
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/privacy");
  });
});
