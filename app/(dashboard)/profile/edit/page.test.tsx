// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { PROFILE_FIELD_NAMES } from "@/lib/profile/fields";

/**
 * The profile edit page loads its form ONCE, from getMyProfile(). The
 * shared-anniversary card beneath it can change the caller's anniversary
 * underneath that form: confirming a request writes the agreed date into
 * BOTH partners' profile_info rows (confirm_anniversary_link). A form still
 * holding the date it loaded must not write the old date back over the
 * agreed one -- that would silently undo the confirm and, for a canonical
 * partner, move the couple's occasion and every claim scoped to it.
 *
 * Save sends the basic fields and only the profile fields the person changed
 * since the page loaded them: a field they did not touch is left out, so
 * updateProfile leaves it as it is, and one they emptied is sent as "", so it
 * is removed.
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
  // Falsifiability: send every field, or re-sync the form's anniversary
  // without also re-syncing what the page counts as loaded, and Save sends an
  // anniversary the person never touched. Removing the page's onLinkChanged
  // handler is caught by the next test, which reads the field.
  it("leaves the agreed date alone, not sending the date the form first loaded", async () => {
    const { container } = render(<ProfileEditPage />);

    await waitFor(() => expect(anniversaryInput().value).toBe(OLD_DATE));

    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await screen.findByText(/shared anniversary:/i);

    fireEvent.change(displayNameInput(container), {
      target: { value: "Kasey S" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    const sent = updateProfile.mock.calls[0][0];
    expect(sent).toMatchObject({ display_name: "Kasey S" });
    expect(sent).not.toHaveProperty("anniversary");
  });

  // Falsifiability: re-sync the whole form with reset(freshProfile) and the
  // unsaved Display Name edit made BEFORE the confirm is thrown away, so the
  // save sends "Kasey" and this fails. Remove the page's onLinkChanged
  // handler and the field never shows the agreed date. NOT caught: unsaved
  // edits to the anniversary field itself, which confirming deliberately
  // replaces -- the card says "Confirming will set your anniversary to that
  // date".
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
    const sent = updateProfile.mock.calls[0][0];
    expect(sent).toMatchObject({ display_name: "Kasey S" });
    expect(sent).not.toHaveProperty("anniversary");
  });
});

describe("ProfileEditPage saving", () => {
  // A field written elsewhere while the page is open (by a partner's confirm,
  // or from the app) must survive a save that did not touch it.
  it("sends the basics and only the fields the person changed", async () => {
    getMyProfile.mockResolvedValue({
      data: {
        username: "kasey",
        display_name: "Kasey",
        bio: "",
        avatar_url: null,
        profile_info: [
          { category: "sizes", field_name: "shoe_size", field_value: "10" },
          { category: "preferences", field_name: "hobbies", field_value: "Chess" },
          { category: "sizes", field_name: "hat_size", field_value: "7" },
        ],
      },
      error: null,
    });
    getMyAnniversaryLinks.mockResolvedValue({
      data: { confirmed: null, outgoing: null, incoming: [] },
    });
    const { container } = render(<ProfileEditPage />);
    const field = (name: string) =>
      container.querySelector(`[name="${name}"]`) as HTMLInputElement;

    await waitFor(() => expect(field("shoe_size").value).toBe("10"));

    fireEvent.change(field("shoe_size"), { target: { value: "11" } });
    fireEvent.change(field("hobbies"), { target: { value: "" } });
    fireEvent.change(field("shirt_size"), { target: { value: "M" } });
    fireEvent.change(field("hat_size"), { target: { value: "8" } });
    fireEvent.change(field("hat_size"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    const sent = updateProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      username: "kasey",
      display_name: "Kasey",
      bio: "",
      shoe_size: "11", // changed: its new value
      hobbies: "", // emptied: "" so it is removed
      shirt_size: "M", // empty at load, typed for the first time
    });
    expect(sent).toHaveProperty("avatar_url");
    // Empty at load and never touched (anniversary, birthday, ...), or
    // changed and put back (hat_size): not sent at all.
    const catalog = Object.keys(sent).filter((key) =>
      (PROFILE_FIELD_NAMES as readonly string[]).includes(key)
    );
    expect(catalog.sort()).toEqual(["hobbies", "shirt_size", "shoe_size"]);
  });

  it("asks for a reload when the anniversary cannot be refreshed, and leaves it alone on Save", async () => {
    let loads = 0;
    getMyProfile.mockImplementation(async () =>
      ++loads === 1
        ? profileWithAnniversary(OLD_DATE)
        : { data: null, error: "canceling statement due to statement timeout" }
    );
    const { container } = render(<ProfileEditPage />);

    await waitFor(() => expect(anniversaryInput().value).toBe(OLD_DATE));

    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await screen.findByText(
      "Couldn't refresh your anniversary. Reload the page to see it."
    );

    fireEvent.change(displayNameInput(container), {
      target: { value: "Kasey S" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    const sent = updateProfile.mock.calls[0][0];
    expect(sent).toMatchObject({ display_name: "Kasey S" });
    expect(sent).not.toHaveProperty("anniversary");
  });
});
