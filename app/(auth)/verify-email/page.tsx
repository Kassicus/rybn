import { Mail } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";

export default function VerifyEmailPage() {
  return (
    <div className="text-center space-y-6">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900 flex items-center justify-center">
          <Mail className="w-8 h-8 text-primary" />
        </div>
      </div>

      <div className="space-y-2">
        <Heading level="h1">Check your email</Heading>
        <Text variant="secondary">
          We&apos;ve sent you a verification link to confirm your email address.
        </Text>
      </div>

      <div className="p-4 rounded bg-light-background-hover dark:bg-dark-background-hover border border-light-border dark:border-dark-border">
        <Text variant="secondary" size="sm">
          Click the link in the email to complete your registration. You can
          close this window.
        </Text>
      </div>
    </div>
  );
}
