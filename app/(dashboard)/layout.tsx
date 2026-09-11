import { TopBar } from "@/components/layout/TopBar";
import { FloatingActionButton } from "@/components/layout/FloatingActionButton";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { DateReminderBanner } from "@/components/reminders/DateReminderBanner";
import { BreadcrumbProvider } from "@/lib/contexts/breadcrumb-context";
import { getUserId } from "@/lib/auth/require-auth";
import { ensureProfile } from "@/lib/auth/ensure-profile";
import { redirect } from "next/navigation";
import { getActiveDateReminders } from "@/lib/actions/date-reminders";
import { unreadCount } from "@/lib/notifications/unread";
import { getMyProfile } from "@/lib/actions/profile";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // /admin/* now matches proxy.ts's matcher too (see its comment, which
  // refers back to this one) -- so this is a second layer behind the
  // middleware, not the only gate. It still has to stay: gating on
  // getUserId() and redirecting here, rather than reaching for a throwing
  // helper like requireAuthWithProfile(), is what keeps an unauthenticated
  // request a 307 to /login instead of a 500 (see that helper's own comment
  // in lib/auth/require-auth.ts).
  const userId = await getUserId();

  if (!userId) {
    redirect("/login");
  }

  // Provisioning, not a gate. requireAuthWithProfile() would THROW here, and a
  // throw in this layout turns the /admin/* redirect above into a 500 — so the
  // signed-out branch stays a redirect and provisioning happens only after it.
  //
  // Every authenticated page renders through this layout, so this covers the
  // whole authenticated surface — but it does NOT sequence anything. Next
  // renders layouts and pages concurrently, so a page body (and the calls
  // below) can run while this insert is still in flight. Accessors that need
  // the row therefore ensure it themselves; getMyProfile() does.
  await ensureProfile();

  // Get active date reminders for the user
  const { data: reminders } = await getActiveDateReminders();

  // Get user profile for TopBar
  const { data: profile } = await getMyProfile();

  // Clerk's auth() returns ids only; the email shown in TopBar comes from the
  // profile row.
  const user = { email: profile?.email ?? undefined };

  return (
    <div className="min-h-screen flex flex-col bg-light-background overflow-x-hidden">
      {/* Same reminders the banner below renders, counted through the one
          shared filter so the bell's badge and /notifications agree. */}
      <TopBar
        user={user}
        profile={profile}
        notificationCount={unreadCount(reminders)}
      />
      <BreadcrumbProvider>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 container mx-auto max-w-screen-2xl">
          {reminders && reminders.length > 0 && (
            <div className="mb-6">
              <DateReminderBanner reminders={reminders} />
            </div>
          )}
          <Breadcrumbs />
          {children}
        </main>
      </BreadcrumbProvider>
      <FloatingActionButton />
    </div>
  );
}
