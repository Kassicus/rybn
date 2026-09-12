"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, UserPlus, X, Check, Link2Off } from "lucide-react";
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
  confirmAnniversaryLink,
  declineAnniversaryLink,
  unlinkAnniversary,
  getMyAnniversaryLink,
  getAnniversaryPartnerCandidates,
  type AnniversaryLink,
  type AnniversaryPartnerCandidate,
} from "@/lib/actions/anniversary-links";
import { formatMonthDay } from "@/lib/utils/dates";

/**
 * The link is an ACTION, not a form field -- DatesSection (the react-hook-
 * form section it renders beneath) stays a pure form. This component fetches
 * and mutates its own state through the Task 8 server actions directly,
 * independent of the surrounding <form>'s submit/reset lifecycle.
 *
 * Three states, driven entirely by getMyAnniversaryLink():
 *   - no link            -> partner picker + date + "Ask to share"
 *   - pending, by me      -> who was asked, + Cancel (declineAnniversaryLink
 *                            -- Task 3's correction lets either participant
 *                            remove a pending link, so "cancel" and
 *                            "decline" are the same call from opposite
 *                            sides)
 *   - pending, not by me   -> who asked, + Confirm / Decline, with the
 *                            overwrite consequence stated outright
 *   - confirmed            -> partner's name, + Unlink
 */
export function AnniversaryPartner() {
  const router = useRouter();

  const [link, setLink] = useState<AnniversaryLink | null>(null);
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
    const [linkResult, candidatesResult] = await Promise.all([
      getMyAnniversaryLink(),
      getAnniversaryPartnerCandidates(),
    ]);

    if ("error" in linkResult) {
      setLoadError(linkResult.error);
    } else {
      setLoadError(null);
      setLink(linkResult.data);
    }

    // A candidates failure only blocks the unlinked state's picker, which
    // getMyAnniversaryLink's own result already gates -- not surfaced as a
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

  // Every mutation re-fetches this component's own state AND asks the
  // server components on the route to re-render, since the bell's badge
  // (dashboard layout) and NotificationsList are computed from this same
  // getMyAnniversaryLink() call and would otherwise go stale.
  const refreshAfterAction = async () => {
    await load();
    router.refresh();
  };

  const partnerLabel = (l: AnniversaryLink) =>
    l.partnerDisplayName || l.partnerUsername || "them";

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

  const handleConfirm = async () => {
    if (!link) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await confirmAnniversaryLink(link.id);
    setIsSubmitting(false);
    if ("error" in result) {
      setActionError(result.error);
      return;
    }
    await refreshAfterAction();
  };

  const handleDecline = async () => {
    if (!link) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await declineAnniversaryLink(link.id);
    setIsSubmitting(false);
    if ("error" in result) {
      setActionError(result.error);
      return;
    }
    await refreshAfterAction();
  };

  const handleUnlink = async () => {
    if (!link) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await unlinkAnniversary(link.id);
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

      {!isLoading && !loadError && link === null && (
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

      {!isLoading && !loadError && link !== null && link.status === "pending" && link.initiatedByMe && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-light-border sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="shrink-0">
              <AvatarFallback>
                {partnerLabel(link).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {/* min-w-0 without truncate: this sentence carries the date the
                initiator proposed -- the only place they can see it -- so it
                wraps instead of clipping. Only the name above it (a single
                token, not load-bearing text) truncates. */}
            <div className="min-w-0">
              <Text className="font-medium truncate">{partnerLabel(link)}</Text>
              <Text variant="secondary" size="sm">
                Waiting for them to confirm {formatMonthDay(link.agreedDate)}{" "}
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

      {!isLoading && !loadError && link !== null && link.status === "pending" && !link.initiatedByMe && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-primary-200 bg-primary-50">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="shrink-0">
              <AvatarFallback>
                {partnerLabel(link).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {/* min-w-0 without truncate -- this embeds the partner's name
                inline in a full sentence rather than isolating it, so there
                is no fixed-length token to clip; it wraps instead. */}
            <Text className="min-w-0 font-medium">
              {partnerLabel(link)} wants to share an anniversary with you
            </Text>
          </div>
          {/* Load-bearing, not decoration: confirming OVERWRITES the
              accepting partner's own anniversary date. The consent design
              rests on this sentence being read before either button is
              pressed. */}
          <Text size="sm">
            {partnerLabel(link)} says your shared anniversary is{" "}
            {formatMonthDay(link.agreedDate)}. Confirming will set your
            anniversary to that date.
          </Text>
          {actionError && (
            <Text size="sm" className="text-error">
              {actionError}
            </Text>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="small" onClick={handleConfirm} loading={isSubmitting}>
              <Check className="w-4 h-4" />
              Confirm
            </Button>
            <Button
              variant="tertiary"
              size="small"
              onClick={handleDecline}
              loading={isSubmitting}
            >
              <X className="w-4 h-4" />
              Decline
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !loadError && link !== null && link.status === "confirmed" && (
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
              <Text className="font-medium truncate">{partnerLabel(link)}</Text>
              {/* The LIVE date, not link.agreedDate (finding I4).
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
                {formatMonthDay(link.sharedDate ?? link.agreedDate)}
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
    </FormSection>
  );
}
