"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { Text } from "@/components/ui/text";
import {
  confirmAnniversaryLink,
  declineAnniversaryLink,
  type AnniversaryLink,
} from "@/lib/actions/anniversary-links";
import { formatMonthDay } from "@/lib/utils/dates";

interface AnniversaryRequestCardProps {
  /** One INCOMING pending request: somebody else asked the viewer. */
  request: AnniversaryLink;
  /**
   * The viewer's own confirmed link, if any. When set, Confirm is not offered
   * -- confirm_anniversary_link would refuse it -- and the card says why,
   * naming only the viewer's OWN partner. Nothing here depends on the
   * requester's status, so the card discloses nothing about them.
   */
  myConfirmedLink: AnniversaryLink | null;
  /**
   * On the profile page the confirmed card sits directly above, so the hint
   * points there instead of linking to the page the viewer is already on.
   */
  onProfilePage?: boolean;
  /** Runs after a successful action, before router.refresh(). */
  onChanged?: () => void | Promise<void>;
}

const nameOf = (link: AnniversaryLink, fallback: string) =>
  link.partnerDisplayName || link.partnerUsername || fallback;

/**
 * One incoming anniversary request, shared by /notifications and the profile
 * page so the consent copy lives in one place.
 *
 * Each card owns its loading and error state: acting on one request must not
 * disable or mislabel the others (a viewer can now hold several -- see
 * getMyAnniversaryLinks). Every handler branches on `"error" in result`
 * alone, so a legitimate `{ ok: false }` from decline (the request was
 * already gone) falls through to a refresh rather than an error.
 */
export function AnniversaryRequestCard({
  request,
  myConfirmedLink,
  onProfilePage = false,
  onChanged,
}: AnniversaryRequestCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requester = nameOf(request, "Someone");

  const run = async (
    action: (linkId: string) => Promise<{ ok: boolean } | { error: string }>
  ) => {
    setLoading(true);
    setError(null);
    const result = await action(request.id);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    await onChanged?.();
    router.refresh();
  };

  return (
    // Stacks below sm: for the same reason the group member cards do
    // (76c1214): a sentence plus two buttons cannot share a row at 375px.
    // min-w-0 on the text block, shrink-0 on the icon well.
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-primary-200 bg-primary-50 sm:flex-row sm:items-start">
      <div className="shrink-0 w-10 h-10 rounded-full bg-white flex items-center justify-center">
        <HeartHandshake className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {/* No truncate: the name is embedded in a full sentence, so there is
            no fixed-length token to clip -- it wraps instead. */}
        <Text>
          <span className="font-medium">{requester}</span> wants to share an
          anniversary with you
        </Text>
        {myConfirmedLink ? (
          <Text size="sm">
            You already share one with{" "}
            {nameOf(myConfirmedLink, "your partner")}. To accept this,{" "}
            {onProfilePage ? (
              "unlink above first."
            ) : (
              <>
                unlink on <Link href="/profile/edit">your profile</Link> first.
              </>
            )}
          </Text>
        ) : (
          // Load-bearing, not decoration: confirming OVERWRITES the
          // accepting partner's own anniversary date, so the consequence is
          // stated outright, naming the date, before either button is
          // pressable.
          <Text size="sm">
            {requester} says your shared anniversary is{" "}
            {formatMonthDay(request.agreedDate)}. Confirming will set your
            anniversary to that date.
          </Text>
        )}
        {error && (
          <Text size="sm" className="text-error">
            {error}
          </Text>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!myConfirmedLink && (
            <Button
              size="small"
              onClick={() => run(confirmAnniversaryLink)}
              loading={loading}
            >
              <Check className="w-4 h-4" />
              Confirm
            </Button>
          )}
          <Button
            variant="tertiary"
            size="small"
            onClick={() => run(declineAnniversaryLink)}
            loading={loading}
          >
            <X className="w-4 h-4" />
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
}
