import Link from "next/link";
import { Logo } from "@/components/vibe/Logo";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4">
        <Link href="/" aria-label="Rybn home" className="inline-block">
          <Logo width={160} height={64} className="h-12 w-auto" />
        </Link>
      </header>
      <main className="flex-1 px-4 pb-20">
        <div className="mx-auto w-full max-w-3xl space-y-8">{children}</div>
      </main>
    </div>
  );
}
