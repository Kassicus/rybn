import type { Metadata } from "next";
import { Heading, Text } from "@/components/ui/text";

export const metadata: Metadata = {
  title: "Terms of Service - Rybn",
  description: "The terms that govern your use of Rybn.",
};

const LIST = "list-disc pl-6 space-y-2 text-light-text-secondary";

export default function TermsOfService() {
  return (
    <>
      <div className="space-y-2">
        <Heading level="h1">Terms of Service</Heading>
        <Text variant="secondary" size="sm">
          Last updated 10 September 2026
        </Text>
      </div>

      <Text variant="secondary">
        These terms govern your use of Rybn. By creating an account or using the
        app, you agree to them. If you do not agree, please do not use Rybn.
      </Text>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Who can use Rybn
        </Heading>
        <Text variant="secondary">
          You must be at least 13 years old. If you are under the age of majority
          where you live, you may use Rybn only with the involvement of a parent
          or guardian.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Your account
        </Heading>
        <Text variant="secondary">
          Accounts are created and secured through Clerk. You are responsible for
          keeping your credentials safe and for activity that happens under your
          account. Please give accurate information when you register, and tell
          us promptly if you believe your account has been compromised.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Acceptable use
        </Heading>
        <Text variant="secondary">You agree not to:</Text>
        <ul className={LIST}>
          <li>Use Rybn to harass, threaten, or abuse anyone.</li>
          <li>Upload content that is unlawful, infringing, or obscene.</li>
          <li>Attempt to access data belonging to other users, or to circumvent the visibility rules the app enforces.</li>
          <li>Probe, scan, or disrupt the service, or use automated means to scrape it.</li>
          <li>Impersonate another person, or misrepresent your affiliation with anyone.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Your content
        </Heading>
        <Text variant="secondary">
          What you create in Rybn — wishlists, messages, images, profile details
          — remains yours. You grant us only the permission needed to operate the
          service: to store your content, and to display it to the people your
          settings and group memberships allow. We do not claim ownership of it
          and we do not use it for anything else.
        </Text>
        <Text variant="secondary">
          You are responsible for what you upload, including having the right to
          upload it.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Groups and shared content
        </Heading>
        <Text variant="secondary">
          Rybn is built around sharing with groups. When you join or create a
          group, members of that group can see what its settings allow — your
          wishlist items, and whichever profile details you have made visible to
          them. Invite deliberately, and review your visibility settings if you
          are unsure what a group can see.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Third-party links and retailers
        </Heading>
        <Text variant="secondary">
          Wishlist items commonly link to products sold by other companies. Rybn
          does not sell anything, does not process payments, and is not a party
          to any purchase you make. Prices and availability we display are read
          from the linked page and may be out of date or wrong. Anything you buy
          is a transaction between you and that retailer, on their terms.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Availability and changes
        </Heading>
        <Text variant="secondary">
          We may change, suspend, or discontinue parts of Rybn. We aim to keep
          the service running and your data intact, but we do not guarantee
          uninterrupted availability, and we recommend keeping your own record of
          anything you would be sorry to lose.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Ending your use
        </Heading>
        <Text variant="secondary">
          You may delete your account at any time. We may suspend or terminate an
          account that breaches these terms or that puts other users at risk.
          Some content you contributed to shared group conversations may remain
          visible to those groups, as described in our Privacy Policy.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Disclaimers
        </Heading>
        <Text variant="secondary">
          Rybn is provided as is, without warranties of any kind, whether express
          or implied, including any warranty of merchantability, fitness for a
          particular purpose, or non-infringement. We do not warrant that the
          service will be error-free or that it will always keep a surprise
          secret — that depends partly on how you and the people around you use
          it.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Limitation of liability
        </Heading>
        <Text variant="secondary">
          To the fullest extent permitted by law, Rybn and the people who operate
          it are not liable for indirect, incidental, special, consequential, or
          punitive damages, or for any loss of data, profits, or goodwill arising
          from your use of the service. Nothing here limits liability that cannot
          be limited by law.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Changes to these terms
        </Heading>
        <Text variant="secondary">
          We may update these terms. When we do, we will change the date at the
          top of this page, and for material changes we will make a reasonable
          effort to tell you. Continuing to use Rybn after a change means you
          accept the updated terms.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Contact
        </Heading>
        <Text variant="secondary">
          Questions about these terms can go to{" "}
          <a href="mailto:support@rybn.app" className="underline">
            support@rybn.app
          </a>
          .
        </Text>
      </section>
    </>
  );
}
