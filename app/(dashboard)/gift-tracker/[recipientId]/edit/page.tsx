import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipientById } from "@/lib/actions/gift-tracking";
import { Heading, Text } from "@/components/ui/text";
import { RecipientForm } from "@/components/gift-tracking";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

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
      {/* Back link */}
      <Link
        href={`/gift-tracker/${recipientId}`}
        className="inline-flex items-center gap-2 text-light-text-secondary hover:text-primary transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        <Text size="sm">Back to {recipient.name}</Text>
      </Link>

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
