"use client";

import { useState } from "react";
import { Mail, CheckCircle, XCircle, Loader2, ExternalLink } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";

export default function TestEmailPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  const handleSendTest = async () => {
    if (!email || !email.includes("@")) {
      setResult({
        success: false,
        message: "Please enter a valid email address",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/test-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: data.message,
          details: data.details,
        });
      } else {
        setResult({
          success: false,
          message: data.error || "Failed to send test email",
          details: data.details,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: "Network error. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Admin", href: "/admin/test-email" },
          { label: "Email Testing", href: "/admin/test-email" },
        ]}
      />
      {/* Header */}
      <div className="space-y-4">
        <Heading level="h2" className="flex items-center gap-3">
          <Mail className="w-8 h-8 text-primary" />
          Email Deliverability Testing
        </Heading>
        <Text variant="secondary">
          Test your email configuration and deliverability score using mail-tester.com.
          This tool helps ensure your emails reach the inbox, not spam.
        </Text>
      </div>

      {/* Instructions */}
      <div className="p-6 rounded-2xl border border-light-border bg-light-background space-y-4">
        <Heading level="h4">How to Test</Heading>
        <ol className="space-y-2 text-light-text-secondary">
          <li className="flex gap-2">
            <span className="font-semibold text-primary">1.</span>
            <span>
              Visit{" "}
              <a
                href="https://www.mail-tester.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                mail-tester.com
                <ExternalLink className="w-3 h-3" />
              </a>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-primary">2.</span>
            <span>Copy the unique test email address they provide</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-primary">3.</span>
            <span>Paste it below and click &quot;Send Test Email&quot;</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-primary">4.</span>
            <span>Return to mail-tester.com and click &quot;Then check your score&quot;</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-primary">5.</span>
            <span>Review your score (aim for 8+/10) and follow their recommendations</span>
          </li>
        </ol>
      </div>

      {/* Test Form */}
      <div className="p-6 rounded-2xl border border-light-border bg-light-background space-y-4">
        <Heading level="h4">Send Test Email</Heading>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-light-text mb-2"
            >
              Mail-Tester Email Address
            </label>
            <input
              id="email"
              type="email"
              placeholder="test-xxxxx@mail-tester.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-light-border bg-white focus:border-primary focus:ring-2 focus:ring-primary-light transition-all"
              disabled={loading}
            />
          </div>
          <Button
            onClick={handleSendTest}
            disabled={loading || !email}
            className="w-full sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Send Test Email
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div
          className={`p-6 rounded-2xl border ${
            result.success
              ? "border-green-200 bg-green-50"
              : "border-red-200 bg-red-50"
          } space-y-4`}
        >
          <div className="flex items-start gap-3">
            {result.success ? (
              <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
            ) : (
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
            )}
            <div className="space-y-2 flex-1">
              <Heading
                level="h4"
                className={result.success ? "text-green-900" : "text-red-900"}
              >
                {result.success ? "Success!" : "Error"}
              </Heading>
              <Text className={result.success ? "text-green-800" : "text-red-800"}>
                {result.message}
              </Text>
              {result.details && (
                <div className="mt-4 p-4 rounded-lg bg-white border border-light-border">
                  <pre className="text-xs text-light-text-secondary overflow-x-auto">
                    {JSON.stringify(result.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* What Gets Tested */}
      <div className="p-6 rounded-2xl border border-light-border bg-light-background space-y-4">
        <Heading level="h4">Email Features Being Tested</Heading>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[
            "HTML and plain text versions",
            "SPF authentication",
            "DKIM signatures",
            "DMARC policy compliance",
            "Reply-To headers",
            "List-Unsubscribe headers",
            "Proper sender configuration",
            "Content spam score",
          ].map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
              <Text size="sm">{feature}</Text>
            </li>
          ))}
        </ul>
      </div>

      {/* Troubleshooting */}
      <div className="p-6 rounded-2xl border border-light-border bg-light-background space-y-4">
        <Heading level="h4">Troubleshooting Low Scores</Heading>
        <div className="space-y-3">
          <div>
            <Text className="font-semibold mb-1">Score below 8/10?</Text>
            <Text size="sm" variant="secondary">
              Check if your DNS records (SPF, DKIM, DMARC) are properly configured in your
              domain registrar and verified in Resend.
            </Text>
          </div>
          <div>
            <Text className="font-semibold mb-1">Authentication failures?</Text>
            <Text size="sm" variant="secondary">
              DNS records can take 24-48 hours to propagate. If you just added them, wait
              and try again later.
            </Text>
          </div>
          <div>
            <Text className="font-semibold mb-1">Still having issues?</Text>
            <Text size="sm" variant="secondary">
              Check the EMAIL_DELIVERABILITY_GUIDE.md in the project root for detailed
              configuration steps and best practices.
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
}
