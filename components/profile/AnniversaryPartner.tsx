"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, UserPlus, X, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/profile/FormSection";
import {
  requestAnniversaryLink,
  declineAnniversaryLink,
  unlinkAnniversary,
  getMyAnniversaryLinks,
  getAnniversaryPartnerCandidates,
  type AnniversaryLink,
  type AnniversaryPartnerCandidate,
  type MyAnniversaryLinks,
} from "@/lib/actions/anniversary-links";
import { formatMonthDay } from "@/lib/utils/dates";
import { AnniversaryRequestCard } from "@/components/notifications/AnniversaryRequestCard";

/**
 * The link is an ACTION, not a form field -- DatesSection (the react-hook-
 * form section it renders beneath) stays a pure form. This component fetches
 * and mutates its own state through the Task 8 server actions directly,
 * independent of the surrounding <form>'s submit/reset lifecycle.
 *
 * Driven by getMyAnniversaryLinks(). The main area shows the caller's OWN
 * state, by priority:
 *   - confirmed           -> partner's name, shared date, + Unlink
 *   - else outgoing        -> who was asked, + Cancel (declineAnniversaryLink
 *                            -- either participant may remove a pending
 *                            link, so "cancel" and "decline" are the same
 *                            call from opposite sides)
 *   - else                 -> partner picker + date + "Ask to share"
 * Beneath it, one AnniversaryRequestCard per INCOMING request -- the same
 * card /notifications renders, so the consent copy lives in one place.
 * An incoming request no longer replaces the picker (design decision 4).
 */
interface AnniversaryPartnerProps {
  /**
   * Runs after any link action here succeeds, including Confirm or Decline
   * on a request card below. The profile edit page uses it to re-read the
   * anniversary its form is holding: confirming writes the agreed date into
   * the caller's own profile_info row, and a form still holding the date it
   * first loaded would write the old one back on Save.
   */
  onLinkChanged?: () => void | Promise<void>;
}

export function AnniversaryPartner({ onLinkChanged }: AnniversaryPartnerProps = {}) {
  const router = useRouter();

  const [links, setLinks] = useState<MyAnniversaryLinks | null>(null);
  const [candidates, setCandidates] = useState<AnniversaryPartnerCandidate[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    // Any reload follows a change -- this card's own action, or a request
    // card's below via onChanged -- so an error left over from an earlier
    // action (say a refused "Ask to share") no longer describes what is on
    // screen and would otherwise reappear inside whichever state renders next.
    setActionError(null);
    const [linkResult, candidatesResult] = await Promise.all([
      getMyAnniversaryLinks(),
      getAnniversaryPartnerCandidates(),
    ]);

    if ("error" in linkResult) {
      setLoadError(linkResult.error);
    } else {
      setLoadError(null);
      setLinks(linkResult.data);
    }

    // A candidates failure only blocks the unlinked state's picker, which
    // getMyAnniversaryLinks' own result already gates -- not surfaced as a
    // page-level error.
    setCandidates("error" in candidatesResult ? [] : candidatesResult.data);

    setIsLoading(false);
  };

  useEffect(() => {
    async function init() {
      await load();
    }
    init();
  }, []);

  // Re-fetches this component's own state and tells the page, whose form may
  // hold a value the action just changed (see onLinkChanged).
  const reloadAndNotify = async () => {
    await load();
    await onLinkChanged?.();
  };

  // Every mutation also asks the server components on the route to
  // re-render, since the bell's badge (dashboard layout) and
  // NotificationsList are computed from getMyAnniversaryLinks() on the
  // server and would otherwise go stale. A request card below does its own
  // router.refresh(), so it gets reloadAndNotify alone.
  const refreshAfterAction = async () => {
    await reloadAndNotify();
    router.refresh();
  };

  const partnerLabel = (l: AnniversaryLink) =>
    l.partnerDisplayName || l.partnerUsername || "them";

  const confirmed = links?.confirmed ?? null;
  const outgoing = links?.outgoing ?? null;
  const incoming = links?.incoming ?? [];

  const handleRequest = async () => {
    if (!selectedPartnerId || !proposedDate) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await requestAnniversaryLink(selectedPartnerId, proposedDate);
    setIsSubmitting(false);
    if ("error" in result) {
      setActionError(result.error);
      return;
    }
    setSelectedPartnerId("");
    setProposedDate("");
    await refreshAfterAction();
  };

  const handleDecline = async () => {
    if (!outgoing) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await declineAnniversaryLink(outgoing.id);
    setIsSubmitting(false);
    if ("error" in result) {
      setActionError(result.error);
      return;
    }
    await refreshAfterAction();
  };

  const handleUnlink = async () => {
    if (!confirmed) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await unlinkAnniversary(confirmed.id);
    setIsSubmitting(false);
    setConfirmingUnlink(false);
    if ("error" in result) {
      setActionError(result.error);
      return;
    }
    await refreshAfterAction();
  };

  return (
    <FormSection
      title="Shared Anniversary"
      description="Link your anniversary with a partner so your groups see one occasion instead of two."
    >
      {isLoading && (
        <Text variant="secondary" size="sm">
          Loading…
        </Text>
      )}

      {!isLoading && loadError && (
        <div className="space-y-2">
          <Text size="sm" className="text-error">
            {loadError}
          </Text>
          <Button variant="secondary" size="small" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {!isLoading && !loadError && !confirmed && !outgoing && (
        <div className="space-y-3">
          <Text variant="secondary" size="sm">
            Once your partner confirms, your groups will see one shared
            anniversary instead of two separate dates.
          </Text>

          {candidates.length === 0 ? (
            <Text variant="secondary" size="sm">
              You don&apos;t share a group with anyone yet.
            </Text>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-0 sm:flex-1">
                <Label htmlFor="anniversary-partner">Partner</Label>
                <Select
                  value={selectedPartnerId}
                  onValueChange={setSelectedPartnerId}
                >
                  <SelectTrigger id="anniversary-partner" className="mt-1">
                    <SelectValue placeholder="Choose someone" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.displayName || c.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0 sm:flex-1">
                <Label htmlFor="anniversary-date">Anniversary date</Label>
                <Input
                  id="anniversary-date"
                  type="date"
                  className="mt-1"
                  value={proposedDate}
                  onChange={(e) => setProposedDate(e.target.value)}
                />
              </div>

              <Button
                onClick={handleRequest}
                loading={isSubmitting}
                disabled={!selectedPartnerId || !proposedDate}
                className="shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                Ask to share
              </Button>
            </div>
          )}

          {actionError && (
            <Text size="sm" className="text-error">
              {actionError}
            </Text>
          )}
        </div>
      )}

      {!isLoading && !loadError && !confirmed && outgoing && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-light-border sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="shrink-0">
              <AvatarFallback>
                {partnerLabel(outgoing).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {/* min-w-0 without truncate: this sentence carries the date the
                initiator proposed -- the only place they can see it -- so it
                wraps instead of clipping. Only the name above it (a single
                token, not load-bearing text) truncates. */}
            <div className="min-w-0">
              <Text className="font-medium truncate">{partnerLabel(outgoing)}</Text>
              <Text variant="secondary" size="sm">
                Waiting for them to confirm {formatMonthDay(outgoing.agreedDate)}{" "}
                as your shared anniversary.
              </Text>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Button
              variant="tertiary"
              size="small"
              onClick={handleDecline}
              loading={isSubmitting}
            >
              <X className="w-4 h-4" />
              Cancel request
            </Button>
          </div>
          {actionError && (
            <Text size="sm" className="text-error w-full">
              {actionError}
            </Text>
          )}
        </div>
      )}

      {!isLoading && !loadError && confirmed && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-light-border sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="shrink-0">
              <AvatarFallback>
                <Heart className="w-4 h-4" />
              </AvatarFallback>
            </Avatar>
            {/* min-w-0 without truncate on the date line: this is the one
                piece of information the card exists to show. Only the name
                above it truncates. */}
            <div className="min-w-0">
              <Text className="font-medium truncate">{partnerLabel(confirmed)}</Text>
              {/* The LIVE date, not confirmed.agreedDate (finding I4).
                  agreed_date is a request-time snapshot: it stops matching
                  the couple's actual anniversary the moment either partner
                  edits their profile, while the occasion their claims are
                  scoped to follows the canonical partner's live
                  profile_info row. This card is the one place the couple is
                  told their shared date, so it has to be the same number.
                  Falls back to agreedDate only when neither partner's row
                  came back at all -- see AnniversaryLink.sharedDate. */}
              <Text variant="secondary" size="sm">
                Shared anniversary:{" "}
                {formatMonthDay(confirmed.sharedDate ?? confirmed.agreedDate)}
              </Text>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {!confirmingUnlink ? (
              <Button
                variant="tertiary"
                size="small"
                onClick={() => setConfirmingUnlink(true)}
              >
                <Link2Off className="w-4 h-4" />
                Unlink
              </Button>
            ) : (
              <>
                <Text size="sm" variant="secondary">
                  Remove this link?
                </Text>
                <Button
                  variant="destructive"
                  size="small"
                  onClick={handleUnlink}
                  loading={isSubmitting}
                >
                  Yes, unlink
                </Button>
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => setConfirmingUnlink(false)}
                >
                  Never mind
                </Button>
              </>
            )}
          </div>
          {actionError && (
            <Text size="sm" className="text-error w-full">
              {actionError}
            </Text>
          )}
        </div>
      )}
      {!isLoading && !loadError && incoming.length > 0 && (
        <div className="mt-4 space-y-3">
          {incoming.map((request) => (
            <AnniversaryRequestCard
              key={request.id}
              request={request}
              myConfirmedLink={confirmed}
              onProfilePage
              onChanged={reloadAndNotify}
            />
          ))}
        </div>
      )}
    </FormSection>
  );
}
