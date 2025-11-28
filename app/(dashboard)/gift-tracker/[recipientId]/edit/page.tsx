import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipientById } from "@/lib/actions/gift-tracking";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { RecipientForm } from "@/components/gift-tracking";

interface PageProps {
  params: Promise<{
    recipientId: string;
  }>;
}

export default async function EditRecipientPage({ params }: PageProps) {
  const { recipientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const recipientResult = await getRecipientById(recipientId);

  if (recipientResult.error || !recipientResult.data) {
    notFound();
  }

  const recipient = recipientResult.data;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Gift Tracker", href: "/gift-tracker" },
          { label: recipient.name, href: `/gift-tracker/${recipientId}` },
          { label: "Edit", href: `/gift-tracker/${recipientId}/edit` },
        ]}
      />
      <div className="mb-6">
        <Heading level="h1">Edit Recipient</Heading>
        <Text variant="secondary">
          Update details for {recipient.name}
        </Text>
      </div>

      <div className="bg-white rounded-lg border border-light-border p-6">
        <RecipientForm recipient={recipient} />
      </div>
    </div>
  );
}
