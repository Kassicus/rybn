// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * The chat's Show earlier messages: offered only while the page says there are earlier ones, asks from the first
 * message shown, and puts what it gets before what is shown. These render the real window and mock the two
 * actions and the realtime client.
 */

const sendMessage = vi.fn();
const getMessages = vi.fn();
vi.mock("@/lib/actions/messages", () => ({
  sendMessage: (data: unknown) => sendMessage(data),
  getMessages: (id: string, page: unknown) => getMessages(id, page),
}));
vi.mock("@/lib/supabase/use-supabase", () => ({
  useSupabase: () => stub,
}));

const channel = { on: () => channel, subscribe: () => channel };
const stub = {
  realtime: { setAuth: () => Promise.resolve() },
  channel: () => channel,
  removeChannel: () => undefined,
};

const { ChatWindow } = await import("./ChatWindow");

const GIFT = "5a1c9e2b-3d4f-4a6b-8c7d-9e0f1a2b3c4d";
const SHOW = { name: "Show earlier messages" };

const row = (n: number, content: string) => ({
  id: `a1000000-0000-4000-8000-00000000000${n}`,
  user_id: "user_2alxABC",
  content,
  attachment_url: null,
  is_edited: false,
  created_at: "2026-11-16T18:02:11Z",
  updated_at: null,
  user_profiles: { id: "user_2alxABC", username: "alex", display_name: "Alex", avatar_url: null },
});

const shown = [row(3, "Third"), row(4, "Fourth")];

const open = (initialHasEarlier: boolean) =>
  render(
    <ChatWindow
      groupGiftId={GIFT}
      initialMessages={shown}
      initialHasEarlier={initialHasEarlier}
      currentUserId="user_2abcDEF"
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  // scrollIntoView does not exist in jsdom.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("ChatWindow's earlier messages", () => {
  it("offers Show earlier messages only while there are earlier ones", async () => {
    open(false);
    expect(screen.queryByRole("button", SHOW)).toBeNull();
    cleanup();
    open(true);
    expect(screen.getByRole("button", SHOW)).toBeTruthy();
  });

  it("puts the earlier messages before the ones shown, asking from the first one", async () => {
    getMessages.mockResolvedValue({ data: [row(1, "First"), row(2, "Second")], hasEarlier: false });
    open(true);
    fireEvent.click(screen.getByRole("button", SHOW));

    await waitFor(() => expect(screen.getByText("First")).toBeTruthy());
    expect(getMessages).toHaveBeenCalledWith(GIFT, { before: shown[0].id });
    const order = ["First", "Second", "Third", "Fourth"].map((t) => screen.getByText(t));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The answer said there is nothing earlier still.
    expect(screen.queryByRole("button", SHOW)).toBeNull();
  });

  it("keeps the button while the answer says there are still earlier ones", async () => {
    getMessages.mockResolvedValue({ data: [row(2, "Second")], hasEarlier: true });
    open(true);
    fireEvent.click(screen.getByRole("button", SHOW));
    await waitFor(() => expect(screen.getByText("Second")).toBeTruthy());
    expect(screen.getByRole("button", SHOW)).toBeTruthy();
  });

  it("shows the action's sentence when earlier messages cannot be read", async () => {
    getMessages.mockResolvedValue({ error: "That isn't there any more." });
    open(true);
    fireEvent.click(screen.getByRole("button", SHOW));
    expect(await screen.findByText("That isn't there any more.")).toBeTruthy();
    expect(screen.getByRole("button", SHOW)).toBeTruthy();
    expect(screen.getByText("Third")).toBeTruthy();
  });
});
