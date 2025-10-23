import { ThemeToggle } from "@/components/vibe/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Heading level="h1">Rybn</Heading>
          <Text variant="secondary">
            Tied Together
          </Text>
          <Text variant="secondary" size="sm">
            Gift giving, beautifully wrapped
          </Text>
          <div className="pt-8">
            <Link href="/login">
              <Button variant="primary" size="large">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
