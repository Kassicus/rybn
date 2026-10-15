// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

/**
 * The profile edit page loads its form ONCE, from getMyProfile(). The
 * shared-anniversary card beneath it can change the caller's anniversary
 * underneath that form: confirming a request writes the agreed date into
 * BOTH partners' profile_info rows (confirm_anniversary_link). Save then
 * sends every field, so a form still holding the date it loaded would write
 * the old date back over the agreed one -- silently undoing the confirm and,
 * for a canonical partner, moving the couple's occasion and every claim
 * scoped to it.
 *
 * These tests render the real page and the real AnniversaryPartner card and
 * mock only what crosses the network (server actions), the router, and the
 * breadcrumb context the page registers with.
 */

const OLD_DATE = "2020-01-01";
const AGREED_DATE = "2024-06-15";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/components/layout/BreadcrumbSetter", () => ({
  BreadcrumbSetter: () => null,
}));

const getMyProfile = vi.fn();
const updateProfile = vi.fn();
vi.mock("@/lib/actions/profile", () => ({
  getMyProfile: () => getMyProfile(),
  updateProfile: (data: unknown) => updateProfile(data),
}));

const getMyAnniversaryLinks = vi.fn();
const confirmAnniversaryLink = vi.fn();
vi.mock("@/lib/actions/anniversary-links", () => ({
  getMyAnniversaryLinks: () => getMyAnniversaryLinks(),
  getAnniversaryPartnerCandidates: async () => ({ data: [] }),
  confirmAnniversaryLink: (id: string) => confirmAnniversaryLink(id),
  declineAnniversaryLink: async () => ({ ok: true }),
  requestAnniversaryLink: async () => ({ data: { linkId: "unused" } }),
  unlinkAnniversary: async () => ({ ok: true }),
}));

const { default: ProfileEditPage } = await import("./page");

const profileWithAnniversary = (anniversary: string) => ({
  data: {
    username: "kasey",
    display_name: "Kasey",
    bio: "",
    avatar_url: null,
    profile_info: [
      { category: "dates", field_name: "anniversary", field_value: anniversary },
    ],
  },
  error: null,
});

const request = {
  id: "link-1",
  partnerId: "user_partner",
  partnerUsername: "sam",
  partnerDisplayName: "Sam",
  status: "pending" as const,
  agreedDate: AGREED_DATE,
  sharedDate: null,
  initiatedByMe: false,
};

const anniversaryInput = () =>
  screen.getByLabelText("Anniversary") as HTMLInputElement;

const displayNameInput = (container: HTMLElement) =>
  container.querySelector('input[name="display_name"]') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();

  // Before the confirm: the caller's own old date, and Sam's request
  // waiting. After it: the agreed date, and a confirmed link.
  let confirmed = false;
  getMyProfile.mockImplementation(async () =>
    profileWithAnniversary(confirmed ? AGREED_DATE : OLD_DATE)
  );
  getMyAnniversaryLinks.mockImplementation(async () => ({
    data: confirmed
      ? {
          confirmed: { ...request, status: "confirmed", sharedDate: AGREED_DATE },
          outgoing: null,
          incoming: [],
        }
      : { confirmed: null, outgoing: null, incoming: [request] },
  }));
  confirmAnniversaryLink.mockImplementation(async () => {
    confirmed = true;
    return { ok: true };
  });
  updateProfile.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
});

describe("ProfileEditPage after confirming an anniversary request", () => {
  // Falsifiability: remove the page's onLinkChanged handler (or the
  // card's call to it) and Save sends OLD_DATE -- the original bug. Re-sync
  // with reset() instead of resetField() and this still passes; the next
  // test is what catches that. NOT caught: a form left open in ANOTHER tab,
  // which this page has no way to hear about.
  it("saves the agreed date, not the date the form first loaded", async () => {
    const { container } = render(<ProfileEditPage />);

    await waitFor(() => expect(anniversaryInput().value).toBe(OLD_DATE));

    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await screen.findByText(/shared anniversary:/i);

    fireEvent.change(displayNameInput(container), {
      target: { value: "Kasey S" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    expect(updateProfile.mock.calls[0][0]).toMatchObject({
      anniversary: AGREED_DATE,
      display_name: "Kasey S",
    });
  });

  // Falsifiability: re-sync the whole form with reset(freshProfile) and the
  // unsaved Display Name edit made BEFORE the confirm is thrown away, so the
  // save sends "Kasey" and this fails. NOT caught: unsaved edits to the
  // anniversary field itself, which confirming deliberately replaces -- the
  // card says "Confirming will set your anniversary to that date".
  it("keeps the caller's other unsaved edits", async () => {
    const { container } = render(<ProfileEditPage />);

    await waitFor(() => expect(anniversaryInput().value).toBe(OLD_DATE));

    fireEvent.change(displayNameInput(container), {
      target: { value: "Kasey S" },
    });

    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await screen.findByText(/shared anniversary:/i);
    await waitFor(() => expect(anniversaryInput().value).toBe(AGREED_DATE));

    expect(displayNameInput(container).value).toBe("Kasey S");

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    expect(updateProfile.mock.calls[0][0]).toMatchObject({
      anniversary: AGREED_DATE,
      display_name: "Kasey S",
    });
  });
});
