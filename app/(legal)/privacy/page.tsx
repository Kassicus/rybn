import type { Metadata } from "next";
import { Heading, Text } from "@/components/ui/text";

export const metadata: Metadata = {
  title: "Privacy Policy - Rybn",
  description: "How Rybn collects, uses, and protects your information.",
};

const LIST = "list-disc pl-6 space-y-2 text-light-text-secondary";

export default function PrivacyPolicy() {
  return (
    <>
      <div className="space-y-2">
        <Heading level="h1">Privacy Policy</Heading>
        <Text variant="secondary" size="sm">
          Last updated 10 September 2026
        </Text>
      </div>

      <Text variant="secondary">
        Rybn is a gift coordination app. It exists so groups of people can share
        wishlists and plan gifts without spoiling the surprise, which means a lot
        of what it does is decide who is allowed to see what. This policy
        explains what we collect, why, and who else is involved.
      </Text>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Information we collect
        </Heading>
        <Text variant="secondary">
          <strong>Account information.</strong> Authentication is handled by
          Clerk. When you register we receive your email address, the username
          you choose, and a display name. If you sign in with Google, we receive
          the basic profile information Google returns — your name, email
          address, and profile picture. We never see your Google password.
        </Text>
        <Text variant="secondary">
          <strong>Profile details you choose to add.</strong> Rybn lets you
          record optional details to help others buy for you: clothing and other
          sizes, preferences, vehicle details, personal details, and important
          dates. All of these are optional, and each carries its own visibility
          setting.
        </Text>
        <Text variant="secondary">
          <strong>Content you create.</strong> Wishlist items, groups and their
          membership, group gifts and the messages sent in their chats, gift
          exchanges, tracked gifts and recipients, and invitations you send.
        </Text>
        <Text variant="secondary">
          <strong>Images you upload.</strong> Wishlist and gift photos are held
          in private storage. They are not publicly browsable, and access is
          granted per request based on the same rules that govern the rest of
          your data.
        </Text>
        <Text variant="secondary">
          <strong>Links you paste.</strong> When you paste a product URL into a
          wishlist item, our server fetches that page to read its title, price,
          description, and image so it can fill the form in for you. The request
          comes from our server, not your browser, and we store only the details
          that end up on the item.
        </Text>
        <Text variant="secondary">
          <strong>Usage data.</strong> We use Vercel Analytics, which collects
          aggregate page-view data. It does not use cookies and does not build a
          profile of individual visitors.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          How we use it
        </Heading>
        <ul className={LIST}>
          <li>To operate the app — showing your lists, groups, and gifts to the right people.</li>
          <li>To enforce visibility rules, which is the core of what Rybn does.</li>
          <li>To send transactional email: a welcome message, group invitations, and reminders about dates you have asked to be reminded of.</li>
          <li>To keep the service secure and diagnose problems.</li>
        </ul>
        <Text variant="secondary">
          We do not sell your personal information, and we do not use it for
          advertising.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Who can see your information inside Rybn
        </Heading>
        <Text variant="secondary">
          This is the part worth reading carefully. Visibility is enforced in the
          database itself, not merely hidden in the interface.
        </Text>
        <ul className={LIST}>
          <li>Your wishlist items are visible to members of groups you share with.</li>
          <li>Optional profile fields carry per-field settings, and can be restricted to particular groups or group types.</li>
          <li>Group gift chats are visible to the participants of that gift — deliberately not to the person receiving it.</li>
          <li>Claiming a gift is hidden from the recipient, so the surprise survives.</li>
        </ul>
        <Text variant="secondary">
          Anyone you invite to a group will be able to see what that group&apos;s
          settings allow. Consider that before adding someone.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Service providers
        </Heading>
        <Text variant="secondary">
          We rely on a small number of providers, each of which processes data on
          our behalf:
        </Text>
        <ul className={LIST}>
          <li><strong>Clerk</strong> — accounts, sign-in, and session management.</li>
          <li><strong>Supabase</strong> — the database and private file storage.</li>
          <li><strong>Resend</strong> — delivery of transactional email.</li>
          <li><strong>Vercel</strong> — hosting and aggregate analytics.</li>
          <li><strong>Google</strong> — only if you choose to sign in with Google.</li>
        </ul>
        <Text variant="secondary">
          We may also disclose information if the law requires it, or where it is
          necessary to protect the rights and safety of our users.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Email preferences
        </Heading>
        <Text variant="secondary">
          You can control which emails you receive from your settings page —
          group invitations, date reminders, gift updates, and exchange
          notifications are each independently controlled. Marketing email is off
          unless you turn it on. Some messages, such as those needed to secure
          your account, are sent regardless.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Retention and deletion
        </Heading>
        <Text variant="secondary">
          We keep your information for as long as your account exists. When you
          delete your account, the data that belongs to you — profile, wishlists,
          gift records, and uploaded images — is deleted along with it. Messages
          you posted in a shared group chat may remain visible to that group, as
          removing them would tear holes in other people&apos;s conversations. To
          request deletion, contact us at the address below.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Security
        </Heading>
        <Text variant="secondary">
          Access rules are enforced by the database through row-level security,
          so a request that should not return your data does not return it, even
          if the interface asks for it. Traffic is encrypted in transit, and
          uploaded images live in private storage rather than public URLs. No
          system is perfectly secure, but the rules are enforced at the layer
          that holds the data rather than the layer that displays it.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Children
        </Heading>
        <Text variant="secondary">
          Rybn is not intended for children under 13, and we do not knowingly
          collect information from them. If you believe a child has created an
          account, contact us and we will remove it.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Changes
        </Heading>
        <Text variant="secondary">
          If this policy changes in a way that materially affects you, we will
          update the date at the top of this page and, where appropriate, tell
          you directly.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Contact
        </Heading>
        <Text variant="secondary">
          Questions about this policy, or about your data, can go to{" "}
          <a href="mailto:support@rybn.app" className="underline">
            support@rybn.app
          </a>
          .
        </Text>
      </section>
    </>
  );
}
