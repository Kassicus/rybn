import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/vibe/ThemeToggle";
import { Logo } from "@/components/vibe/Logo";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import Link from "next/link";

export default async function Home() {
  // Check if user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If logged in, redirect to dashboard
  if (user) {
    redirect("/dashboard");
  }

  // Show landing page for logged-out users
  return (
    <div className="min-h-screen flex flex-col">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex justify-center mb-4">
            <Logo width={300} height={120} className="h-24 w-auto" />
          </div>
          <Text variant="secondary">
            Tied Together
          </Text>
          <Text variant="secondary" size="sm">
            Gift giving, beautifully wrapped
          </Text>
          <div className="pt-8 flex gap-3 justify-center">
            <Link href="/login">
              <Button variant="primary" size="large">
                Log In
              </Button>
            </Link>
            <Link href="/register">
              <Button variant="secondary" size="large">
                Sign Up
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
