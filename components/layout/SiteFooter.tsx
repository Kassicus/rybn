import Link from "next/link";

/**
 * The foot of every signed-out page: the front page, and the support, terms
 * and privacy pages. Support, Privacy and Terms are the pages the App Store
 * listing points at, so they are one tap from anywhere a visitor lands.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-light-border">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-8">
        <div className="grid gap-1 text-sm text-light-text-tertiary">
          <p>Rybn - gift giving, beautifully wrapped</p>
          <p>
            &copy; {new Date().getFullYear()} Karnyx Labs LLC · Developed by{" "}
            <a
              href="https://karnyxlabs.com"
              className="whitespace-nowrap text-light-text-secondary hover:text-primary"
            >
              Karnyx Labs
            </a>
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-6 text-sm">
          <Link href="/support" className="text-light-text-secondary hover:text-primary">
            Support
          </Link>
          <Link href="/privacy" className="text-light-text-secondary hover:text-primary">
            Privacy
          </Link>
          <Link href="/terms" className="text-light-text-secondary hover:text-primary">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
