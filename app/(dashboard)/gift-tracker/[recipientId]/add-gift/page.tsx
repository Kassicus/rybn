import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipientById, getMyRecipients } from "@/lib/actions/gift-tracking";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { GiftForm } from "@/components/gift-tracking";

interface PageProps {
  params: Promise<{
    recipientId: string;
  }>;
}

export default async function AddGiftPage({ params }: PageProps) {
  const { recipientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [recipientResult, recipientsResult] = await Promise.all([
    getRecipientById(recipientId),
    getMyRecipients(),
  ]);

  if (recipientResult.error || !recipientResult.data) {
    notFound();
  }

  const recipient = recipientResult.data;
  const recipients = recipientsResult.data || [];

  return (
    <div className="max-w-2xl mx-auto p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Gift Tracker", href: "/gift-tracker" },
          { label: recipient.name, href: `/gift-tracker/${recipientId}` },
          { label: "Add Gift", href: `/gift-tracker/${recipientId}/add-gift` },
        ]}
      />
      <div className="mb-6">
        <Heading level="h1">Add Gift</Heading>
        <Text variant="secondary">
          Add a gift for {recipient.name}
        </Text>
      </div>

      <div className="bg-white rounded-lg border border-light-border p-6">
        <GiftForm
          recipients={recipients}
          defaultRecipientId={recipientId}
        />
      </div>
    </div>
  );
}
