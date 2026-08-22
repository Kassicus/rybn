import { TopBar } from "@/components/layout/TopBar";
import { FloatingActionButton } from "@/components/layout/FloatingActionButton";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { DateReminderBanner } from "@/components/reminders/DateReminderBanner";
import { BreadcrumbProvider } from "@/lib/contexts/breadcrumb-context";
import { getUserId } from "@/lib/auth/require-auth";
import { redirect } from "next/navigation";
import { getActiveDateReminders } from "@/lib/actions/date-reminders";
import { getMyProfile } from "@/lib/actions/profile";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout is the only gate on /admin/* — those routes match neither the
  // middleware matcher nor any other check — so this redirect must stay.
  const userId = await getUserId();

  if (!userId) {
    redirect("/login");
  }

  // Get active date reminders for the user
  const { data: reminders } = await getActiveDateReminders();

  // Get user profile for TopBar
  const { data: profile } = await getMyProfile();

  // Clerk's auth() returns ids only; the email shown in TopBar comes from the
  // profile row.
  const user = { email: profile?.email ?? undefined };

  return (
    <div className="min-h-screen flex flex-col bg-light-background overflow-x-hidden">
      <TopBar user={user} profile={profile} />
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
