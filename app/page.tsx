import { redirect } from "next/navigation";
import { Logo } from "@/components/vibe/Logo";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import Link from "next/link";

import { getUserId } from "@/lib/auth/require-auth";
export default async function Home() {
  // Check if user is authenticated
  const userId = await getUserId();

  // If logged in, redirect to dashboard
  if (userId) {
    redirect("/dashboard");
  }

  // Show landing page for logged-out users
  return (
    <div className="min-h-screen flex flex-col">
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
