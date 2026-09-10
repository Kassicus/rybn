import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/vibe/Logo";
import { Button } from "@/components/ui/button";
import { getUserId } from "@/lib/auth/require-auth";

export const metadata: Metadata = {
  title: "Rybn - Gift giving, beautifully wrapped",
  description:
    "Rybn keeps wishlists, group gifts and gift exchanges in one place, so everyone knows what to buy and nobody spoils the surprise.",
};

// Each section hangs off the ribbon that runs down the page. The name is the
// motif: Rybn ties a group together, so the page is literally threaded.
const THINGS = [
  {
    heading: "Wishlists people can actually see",
    body: "Add what you want, with links, prices and photos. Paste a product URL and Rybn fills in the details for you. The people you share with see the list; you see nothing about who claimed what.",
  },
  {
    heading: "Groups for the parts of your life",
    body: "Family, friends, work, or something you name yourself. Every optional detail on your profile - sizes, preferences, important dates - carries its own visibility, so your colleagues need not know your shoe size.",
  },
  {
    heading: "Group gifts, planned in private",
    body: "Go in together on something bigger. The gift has its own chat for working out who pays what, and the person receiving it cannot see any of it.",
  },
  {
    heading: "Gift exchanges without the paper hat",
    body: "Draw names for a secret exchange, and let everyone browse their recipient's wishlist instead of guessing.",
  },
  {
    heading: "A record of what you have bought",
    body: "Track gifts per person across the year, so you stop buying the same candle twice and remember what you hid in the loft.",
  },
  {
    heading: "Reminders before it is too late",
    body: "Birthdays and anniversaries you have asked to be reminded about, by email, early enough to do something about it.",
  },
];

export default async function Home() {
  const userId = await getUserId();
  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-light-background">
      <header className="mx-auto max-w-3xl px-6 pt-16 pb-12 text-center">
        <Logo width={300} height={120} className="mx-auto h-20 w-auto" />
        <p className="font-heading mt-6 text-lg text-primary">Tied Together</p>
        <h1 className="mt-8 text-3xl font-semibold leading-tight text-[#002700] sm:text-4xl">
          Everyone&apos;s wishlist in one place, without spoiling the surprise
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-light-text-secondary">
          Rybn is where a family, a group of friends or a team keeps track of
          what everyone actually wants - and quietly sorts out who is buying it.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/register">
            <Button variant="primary" size="large">
              Create an account
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" size="large">
              Sign in
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-20">
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute bottom-3 left-[5px] top-3 w-px bg-primary/25"
          />
          <div className="space-y-12">
            {THINGS.map((thing) => (
              <section key={thing.heading} className="relative pl-12">
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-[7px] h-[11px] w-[11px] rounded-full bg-primary ring-4 ring-light-background"
                />
                <h2 className="text-xl font-semibold text-[#002700]">
                  {thing.heading}
                </h2>
                <p className="mt-2 text-light-text-secondary">{thing.body}</p>
              </section>
            ))}
          </div>
        </div>

        <section className="mt-20 rounded-lg bg-light-background-secondary p-8">
          <h2 className="text-xl font-semibold text-[#002700]">
            Signing in with Google
          </h2>
          <p className="mt-2 text-light-text-secondary">
            You can create a Rybn account with an email address and password, or
            with your Google account. Choosing Google tells us only your name,
            email address and profile picture, which become your Rybn profile.
            We never see your Google password, we do not read your mail or
            contacts, and we do not sell your information or use it for
            advertising. What we hold and why is set out in full in our{" "}
            <Link href="/privacy" className="text-primary underline">
              privacy policy
            </Link>
            .
          </p>
        </section>
      </main>

      <footer className="border-t border-light-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <p className="text-sm text-light-text-tertiary">
            Rybn - gift giving, beautifully wrapped
          </p>
          <nav className="flex gap-6 text-sm">
            <Link href="/privacy" className="text-light-text-secondary hover:text-primary">
              Privacy
            </Link>
            <Link href="/terms" className="text-light-text-secondary hover:text-primary">
              Terms
            </Link>
            <a
              href="mailto:support@rybn.app"
              className="text-light-text-secondary hover:text-primary"
            >
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
