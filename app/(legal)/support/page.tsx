import type { Metadata } from "next";
import Link from "next/link";
import { Heading, Text } from "@/components/ui/text";

export const metadata: Metadata = {
  title: "Support - Rybn",
  description: "Help with Rybn, and how to report a problem.",
};

const LIST = "list-disc pl-6 space-y-2 text-light-text-secondary";

export default function Support() {
  return (
    <>
      <div className="space-y-2">
        <Heading level="h1">Support</Heading>
        <Text variant="secondary" size="sm">
          For Rybn on the web and the Rybn app for iPhone
        </Text>
      </div>

      <Text variant="secondary">
        If something is not working, or you cannot find how to do something,
        write to{" "}
        <a href="mailto:support@rybn.app" className="underline">
          support@rybn.app
        </a>
        . A person reads every message, and we aim to answer within two working
        days.
      </Text>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          Common questions
        </Heading>
        <Text variant="secondary">
          <strong>Why can I not see who claimed something on my list?</strong>{" "}
          That is on purpose. Rybn never tells the owner of a wishlist what was
          claimed or bought, or by whom, so the surprise survives.
        </Text>
        <Text variant="secondary">
          <strong>How do I join a group?</strong> Ask someone in the group to
          invite you by email, or to give you the group&apos;s invite code, and
          enter the code under Groups.
        </Text>
        <Text variant="secondary">
          <strong>Who can see my wishlist and my profile?</strong> Each wishlist
          item says who can see it: everyone in your groups, one group, or only
          you. Profile details are shown to the kinds of group you choose under
          Who can see your profile.
        </Text>
        <Text variant="secondary">
          <strong>How do I add something from another app on my iPhone?</strong>{" "}
          In Safari or a shop&apos;s app, tap Share, then Rybn. If Rybn is hard
          to find in the row of apps, tap More at the end of the row, then Edit,
          and add Rybn to your favourites.
        </Text>
        <Text variant="secondary">
          <strong>How do I change my password or how I sign in?</strong> Open
          Password and security from the Account tab of the app, or go to{" "}
          <a href="https://accounts.rybn.app/user" className="underline">
            accounts.rybn.app
          </a>
          .
        </Text>
        <Text variant="secondary">
          <strong>How do I delete my account?</strong> On the website, open
          Settings, then Delete account. In the iPhone app, open Account, then
          Delete account. Either way your profile, wishlists, gift records and
          pictures are deleted with it, and it cannot be undone.
        </Text>
      </section>

      <section id="report" className="space-y-3 scroll-mt-8">
        <Heading as="h2" level="h3">
          Report a problem
        </Heading>
        <Text variant="secondary">
          Use this for anything that should not be on Rybn, and for anyone who
          is misusing it: something on a list, a profile or a picture that is
          offensive or unlawful, a person in one of your groups who is harassing
          someone, or a fault in the app or the site.
        </Text>
        <Text variant="secondary">
          Write to{" "}
          <a
            href="mailto:support@rybn.app?subject=Report%20a%20problem"
            className="underline"
          >
            support@rybn.app
          </a>{" "}
          and tell us:
        </Text>
        <ul className={LIST}>
          <li>the email address on your Rybn account;</li>
          <li>the name of the group it is in, if it is in one;</li>
          <li>the name of the person, or of the item;</li>
          <li>what is wrong, in your own words.</li>
        </ul>
        <Text variant="secondary">
          We read every report and write back to say what we did. We can remove
          content, and suspend or close an account that breaks the{" "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>
          . In the meantime you can leave a group at any time, from the
          group&apos;s own menu, and the person who made a group can delete it.
        </Text>
      </section>

      <section className="space-y-3">
        <Heading as="h2" level="h3">
          The small print
        </Heading>
        <Text variant="secondary">
          What we collect, and who can see what, is in the{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          . The terms you agree to by using Rybn are in the{" "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>
          . Rybn is made by Karnyx Labs LLC.
        </Text>
      </section>
    </>
  );
}
