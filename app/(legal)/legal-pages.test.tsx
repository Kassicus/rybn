// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TermsOfService from "./terms/page";
import PrivacyPolicy from "./privacy/page";

/**
 * The terms and the privacy policy cover the iPhone app as well as the site.
 * These are the points the App Store's review looks for, and the ones that
 * went out of date when the app arrived.
 */
describe("the terms of service", () => {
  afterEach(cleanup);

  it("cover the iPhone app", () => {
    render(<TermsOfService />);
    expect(screen.getByText(/in the Rybn app for iPhone/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The iPhone app" })).toBeTruthy();
  });

  it("say objectionable content is not tolerated, and where to report it", () => {
    render(<TermsOfService />);
    expect(screen.getByText(/do not tolerate objectionable content or abusive behaviour/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reporting a problem" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Support page" }).getAttribute("href")).toBe("/support#report");
  });
});

describe("the privacy policy", () => {
  afterEach(cleanup);

  it("covers signing in with Apple", () => {
    render(<PrivacyPolicy />);
    expect(screen.getByText(/If you sign in with Apple/)).toBeTruthy();
    expect(screen.getByText(/only if you choose to sign in with Apple/)).toBeTruthy();
  });

  it("says what the iPhone app keeps on the phone and asks for", () => {
    render(<PrivacyPolicy />);
    expect(screen.getByRole("heading", { name: "The iPhone app" })).toBeTruthy();
    expect(screen.getByText(/no advertising and no tracking/)).toBeTruthy();
  });

  it("says an account can be deleted without writing to anyone", () => {
    render(<PrivacyPolicy />);
    expect(screen.getByText(/You can delete your account yourself/)).toBeTruthy();
  });
});
