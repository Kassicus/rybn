"use server";

import { createHash, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendDateReminderEmail } from "@/lib/resend/send";
import { formatMonthDay } from "@/lib/utils/dates";

import { getUserId } from "@/lib/auth/require-auth";

/**
 * Whether the caller presented CRON_SECRET.
 *
 * Digest-then-compare, not `===`. This decides access on an endpoint anyone
 * can POST to, so a byte-by-byte comparison is a timing oracle for the secret.
 * Hashing both sides first makes them 32 bytes each, which also stops
 * timingSafeEqual from leaking the secret's length through the early return.
 *
 * Fails CLOSED when CRON_SECRET is unset. An unconfigured deployment must send
 * no mail rather than let anyone trigger it.
 */
function presentsCronSecret(provided: string | undefined | null): boolean {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error(
      "checkAndSendDateReminders: CRON_SECRET is not configured -- refusing to run"
    );
    return false;
  }

  if (!provided) {
    return false;
  }

  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest()
  );
}

/**
 * "Alex & Sam" for the surviving reminder of a linked couple.
 *
 * Called ONLY for a recipient who shares a group with both partners -- the
 * caller decides that with recipientSeesPartner(); this function does not
 * gate, it only renders. Anyone else gets the single-name form instead.
 *
 * Matches occasionLabel's (lib/occasions/display.ts) name resolution on
 * purpose: display name preferred over username.
 *
 * The two halves do NOT share a last-resort floor, and an earlier version of
 * this comment claimed they did. The CELEBRANT falls back to
 * `celebrantUsernameFallback` -- the username the reminder RPC already
 * returned on the row -- and only the PARTNER, who has no such row and is
 * known solely through the batched lookup below, falls back to "Someone".
 * The asymmetry is deliberate and better than the symmetry it was described
 * as having: real data is preferred over a placeholder wherever real data is
 * in hand. "Someone" is reached only when a profile row failed to come back
 * for the partner.
 *
 * occasionLabel itself is not called from here -- it takes an
 * UpcomingOccasion, which this reminder pipeline (sourced from
 * get_upcoming_dates_for_notifications, not get_upcoming_occasions) never
 * constructs -- so the two names are resolved from the same user_profiles
 * columns by a second, small implementation instead of a shared function.
 *
 * Module-private: a "use server" file may export only async functions, and
 * this is neither exported nor async.
 */
function coupleCelebrantName(
  profilesById: Map<string, { username: string | null; display_name: string | null }>,
  celebrantId: string,
  celebrantUsernameFallback: string,
  partnerId: string
): string {
  const celebrant = profilesById.get(celebrantId);
  const who =
    celebrant?.display_name ?? celebrant?.username ?? celebrantUsernameFallback;
  const partner = profilesById.get(partnerId);
  const partnerWho = partner?.display_name ?? partner?.username ?? "Someone";
  return `${who} & ${partnerWho}`;
}

/**
 * Check for upcoming dates and send reminders.
 *
 * THE SECRET IS CHECKED HERE, not only in the route that calls this.
 *
 * This file is "use server", so every export is a publicly reachable HTTP
 * endpoint whether or not any component references it. This particular one
 * runs on the SERVICE-ROLE client and reads every user's email address,
 * display name, birthdate, group names and Clerk id, then mails them -- so
 * with no identity check it was a full unauthenticated read of the user table
 * plus an open mail relay. The CRON_SECRET check lived on
 * /api/cron/check-date-reminders, i.e. on ONE CALLER, and a guard on a caller
 * guards only that caller.
 *
 * Which is why the secret is a parameter rather than something read from the
 * request: a server action has no request to inspect. Passing it makes the
 * authorisation explicit at every call site and impossible to forget by adding
 * a second one.
 *
 * @param cronSecret - CRON_SECRET, proving this is a scheduled invocation
 * @param daysAhead - How many days ahead to check (default: 1 for tomorrow)
 * @returns Object with counts of notifications sent and any errors
 */
export async function checkAndSendDateReminders(
  cronSecret: string | undefined,
  daysAhead: number = 1
) {
  if (!presentsCronSecret(cronSecret)) {
    console.error("checkAndSendDateReminders: rejected unauthorised invocation");
    return { error: "Not authorized", sent: 0 };
  }

  // Use admin client for service-level operations
  const supabase = createAdminClient();

  const currentYear = new Date().getFullYear();

  // Get upcoming dates that need notifications
  const { data: upcomingDates, error: queryError } = await supabase
    .rpc('get_upcoming_dates_for_notifications', {
      days_ahead: daysAhead,
      target_year: currentYear,
    });

  if (queryError) {
    console.error('Error fetching upcoming dates:', queryError);
    return { error: queryError.message, sent: 0 };
  }

  if (!upcomingDates || upcomingDates.length === 0) {
    return { sent: 0, message: 'No upcoming dates found' };
  }

  // A confirmed couple's anniversary reaches this RPC as TWO rows -- one per
  // partner's own profile_info entry -- because get_upcoming_dates_for_
  // notifications has no notion of anniversary_links; it only knows
  // profile_info. Left alone, every shared group member is mailed twice for
  // one event.
  //
  // Source of truth for "is this the non-canonical half": anniversary_links
  // itself, not anniversary_link_members. anniversary_link_members only
  // records THAT a person is in a confirmed link, not which side -- turning
  // that into canonical/non-canonical would still mean joining back to
  // anniversary_links for user_a/user_b. anniversary_links carries both
  // columns directly, and the same read also gives Step 3b's
  // canonical -> partner mapping, so one query answers both questions.
  //
  // Read as a set/map before the loop rather than per-row: `user_a < user_b`
  // is a property of the pair, not of any one dateInfo row, so it only needs
  // to be known once per run, not once per notification.
  const nonCanonicalCelebrantIds = new Set<string>();
  const partnerIdByCanonicalCelebrantId = new Map<string, string>();
  const canonicalIdByNonCanonicalCelebrantId = new Map<string, string>();

  if (upcomingDates.some((d) => d.field_name === 'anniversary')) {
    const { data: confirmedLinks, error: linksError } = await supabase
      .from('anniversary_links')
      .select('user_a, user_b')
      .eq('status', 'confirmed');

    if (linksError) {
      // Fails OPEN on the dedupe/copy fix, not on sending mail: worst case a
      // couple gets two reminders this run, which is the pre-existing
      // behaviour this task improves on, not the reminders outage the
      // catch-all in getActiveDateReminders below exists to prevent.
      console.error('Error fetching anniversary links for reminder dedupe:', linksError);
    }

    for (const link of confirmedLinks ?? []) {
      nonCanonicalCelebrantIds.add(link.user_b);
      partnerIdByCanonicalCelebrantId.set(link.user_a, link.user_b);
      canonicalIdByNonCanonicalCelebrantId.set(link.user_b, link.user_a);
    }
  }

  // Which (recipient, canonical celebrant) anniversary pairs this run
  // actually produced -- the dedupe's missing half.
  //
  // FINDING I3. The dedupe used to drop EVERY anniversary row whose celebrant
  // was any confirmed link's user_b, globally, without checking that the same
  // recipient was also getting the user_a row that is supposed to stand in
  // for it. But every source row is independently gated on
  // can_view_field(celebrant, notified_user, ...) inside
  // get_upcoming_dates_for_notifications -- so a recipient who can see only
  // the NON-canonical partner's date received the user_b row and no user_a
  // row at all, and the global dedupe then deleted the only reminder they
  // were ever going to get:
  //
  //   source rows:  user_b -> recipient_1,  user_b -> recipient_2
  //   after dedupe: (none)
  //
  // recipient_2 got a reminder before this feature existed. Silently
  // withdrawing it is the spec's explicitly REJECTED option -- "hide unless
  // both are visible ... takes away access a viewer already legitimately
  // had" -- arriving through the reminder path instead of the read path.
  //
  // Keyed on the pair rather than on the celebrant alone, and built from the
  // same `upcomingDates` the loop below iterates, so "does this recipient
  // also have the canonical row" is answered from THIS run's rows rather than
  // from what some other recipient received. The `|` separator cannot
  // occur inside a Clerk user id, so two different pairs cannot collide on
  // one key.
  // The symmetric set is what decides the COPY, not the dedupe: which
  // (recipient, NON-canonical celebrant) pairs this run produced.
  //
  // PER-RECIPIENT PARTNER NAMING (owner decision). Name both partners only
  // when the recipient shares a group with each of them; otherwise name only
  // the partner they can see. One occasion, one date, one email -- different
  // copy per viewer.
  //
  // Why the copy needs a gate at all. get_upcoming_dates_for_notifications
  // gates every row on the CELEBRANT alone: it inner-joins group_members for
  // pi.user_id and then applies can_view_field(pi.user_id, gm.user_id, ...).
  // Nothing in it consults the recipient's relationship to the OTHER partner.
  // Meanwhile user_profiles' own SELECT policy is group-gated ("Users can view
  // profiles of group members"), so a recipient who shares no group with the
  // partner cannot read that partner's display name through the app at all --
  // and this pipeline runs on createAdminClient(), which applies no RLS. Left
  // ungated, the email handed a recipient a name, and an association, that the
  // application's own RLS would refuse them.
  //
  // The run's own rows are the signal, so this costs no extra query: the RPC
  // applied that same can_view_field gate to the NON-canonical partner's row
  // too, so "this recipient received user_b's row" IS "this recipient can see
  // user_b". Group-agnostic on purpose -- sharing ANY group with each partner
  // is the stated rule, and the recipient may share different groups with each.
  const canonicalRowKeys = new Set<string>();
  const nonCanonicalRowKeys = new Set<string>();
  for (const dateInfo of upcomingDates) {
    if (dateInfo.field_name !== 'anniversary') continue;
    const key = `${dateInfo.notified_user_id}|${dateInfo.celebrant_id}`;
    if (partnerIdByCanonicalCelebrantId.has(dateInfo.celebrant_id)) {
      canonicalRowKeys.add(key);
    } else if (nonCanonicalCelebrantIds.has(dateInfo.celebrant_id)) {
      nonCanonicalRowKeys.add(key);
    }
  }

  /**
   * Whether this recipient may be told BOTH partners' names.
   *
   * True exactly when they also received the non-canonical partner's own row
   * from the RPC, which is the can_view_field gate answered for that partner.
   */
  const recipientSeesPartner = (recipientId: string, partnerId: string) =>
    nonCanonicalRowKeys.has(`${recipientId}|${partnerId}`);

  // FINDING R1 -- the dedupe's re-run idempotence, which keying it to THIS
  // run's rows quietly gave away.
  //
  // get_upcoming_dates_for_notifications suppresses any row it has already
  // notified on (`not exists (select 1 from date_notifications dn where
  // dn.celebrant_id = pi.user_id and dn.notified_user_id = gm.user_id and
  // dn.field_name = pi.field_name and dn.notification_year = target_year and
  // dn.group_id = g.id)`). So run 1 inserts the canonical row's notification
  // and drops the non-canonical row; on any LATER invocation while the date
  // is still in window the RPC excludes the canonical row -- its notification
  // exists now -- and returns the non-canonical row alone. canonicalRowKeys is
  // empty for that pair, the drop condition below is false, and the couple
  // sends a SECOND email for one event, naming only the non-canonical half.
  // The global dedupe this replaced was immune because it never asked what
  // else the run contained.
  //
  // Fix: "this recipient already HAS a canonical reminder for this couple
  // this year" counts the same as "the canonical row is present in this run".
  // Both mean the same thing to the recipient -- the merged reminder has been
  // or is being sent -- and the second is simply the first, one run earlier.
  //
  // Presence of the row is the test, not email_sent: that is exactly what the
  // RPC's own not-exists guard keys on, so anything stricter here would
  // disagree with the guard that produced these rows. Group-agnostic, matching
  // the drop key, which is per (recipient, couple) rather than per group.
  //
  // Only asked for pairs this run's own rows cannot already answer, so the
  // ordinary case -- both halves in one run -- issues no query at all.
  const alreadyNotifiedCanonicalKeys = new Set<string>();
  const priorLookupRecipients = new Set<string>();
  const priorLookupCanonicalIds = new Set<string>();

  for (const dateInfo of upcomingDates) {
    if (dateInfo.field_name !== 'anniversary') continue;
    const canonicalId = canonicalIdByNonCanonicalCelebrantId.get(
      dateInfo.celebrant_id
    );
    if (!canonicalId) continue;
    if (canonicalRowKeys.has(`${dateInfo.notified_user_id}|${canonicalId}`)) {
      continue;
    }
    priorLookupRecipients.add(dateInfo.notified_user_id);
    priorLookupCanonicalIds.add(canonicalId);
  }

  if (priorLookupRecipients.size > 0) {
    const { data: priorNotifications, error: priorError } = await supabase
      .from('date_notifications')
      .select('notified_user_id, celebrant_id')
      .eq('field_name', 'anniversary')
      .eq('notification_year', currentYear)
      .in('notified_user_id', Array.from(priorLookupRecipients))
      .in('celebrant_id', Array.from(priorLookupCanonicalIds));

    if (priorError) {
      // Fails OPEN, like the links read above, and for the sharper of the two
      // reasons: failing closed here would treat every partner-side-only
      // recipient as already reminded and withdraw the one reminder finding
      // I3 exists to preserve. A duplicate email is a nuisance; silently
      // taking away a reminder someone had before this feature existed is the
      // spec's explicitly rejected option.
      console.error(
        'Error reading prior anniversary notifications for re-run dedupe:',
        priorError
      );
    }

    for (const prior of priorNotifications ?? []) {
      alreadyNotifiedCanonicalKeys.add(
        `${prior.notified_user_id}|${prior.celebrant_id}`
      );
    }
  }

  /**
   * Whether the canonical half's reminder already stands for this recipient --
   * either produced by this run, or inserted by an earlier one this year.
   */
  const canonicalReminderStandsFor = (recipientId: string, canonicalId: string) =>
    canonicalRowKeys.has(`${recipientId}|${canonicalId}`) ||
    alreadyNotifiedCanonicalKeys.has(`${recipientId}|${canonicalId}`);

  // Profiles for both halves of every couple whose combined copy will actually
  // be rendered, batched into one lookup rather than one query per
  // notification. Narrowed by the same gate as the copy itself: a name no
  // recipient in this run is entitled to see is not fetched at all, rather
  // than fetched under the service role and then discarded.
  const coupleProfileIds = new Set<string>();
  for (const dateInfo of upcomingDates) {
    if (dateInfo.field_name !== 'anniversary') continue;
    const partnerId = partnerIdByCanonicalCelebrantId.get(dateInfo.celebrant_id);
    if (!partnerId) continue;
    if (!recipientSeesPartner(dateInfo.notified_user_id, partnerId)) continue;
    coupleProfileIds.add(dateInfo.celebrant_id);
    coupleProfileIds.add(partnerId);
  }

  const coupleProfilesById = new Map<
    string,
    { username: string | null; display_name: string | null }
  >();

  if (coupleProfileIds.size > 0) {
    const { data: coupleProfiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, username, display_name')
      .in('id', Array.from(coupleProfileIds));

    if (profilesError) {
      // Fails open the same way: coupleCelebrantName falls back to the
      // RPC-provided username when a profile did not come back.
      console.error('Error fetching partner profiles for reminder copy:', profilesError);
    }

    for (const profile of coupleProfiles ?? []) {
      coupleProfilesById.set(profile.id, {
        username: profile.username,
        display_name: profile.display_name,
      });
    }
  }

  let sentCount = 0;
  const errors: Array<{ email: string; error: string }> = [];

  // Process each notification
  for (const dateInfo of upcomingDates) {
    try {
      // Step 3: drop the non-canonical half's row before it is ever
      // inserted -- the canonical half's own row stands for the pair. Gated
      // on field_name === 'anniversary' as well as membership so that a
      // birthday which happens to share a celebrant_id with someone's
      // non-canonical anniversary link (not possible today, but not this
      // check's job to assume) is never touched.
      //
      // PER RECIPIENT, not globally (finding I3, see the canonicalRowKeys
      // note above): the row is dropped only when THIS notified_user_id is
      // also getting the canonical partner's row in this same run -- or
      // already got it in an earlier run this year (finding R1). A recipient
      // who can see only the non-canonical partner's date has neither, so
      // theirs survives and they keep the one reminder they had before this
      // feature existed.
      const canonicalIdForThisRow = canonicalIdByNonCanonicalCelebrantId.get(
        dateInfo.celebrant_id
      );
      if (
        dateInfo.field_name === 'anniversary' &&
        canonicalIdForThisRow &&
        canonicalReminderStandsFor(
          dateInfo.notified_user_id,
          canonicalIdForThisRow
        )
      ) {
        continue;
      }

      // Step 3b: the surviving reminder is keyed to whichever id sorts
      // smaller, which a recipient has no reason to think of as "the"
      // anniversary owner. Name both partners, matching occasionLabel's
      // "Alex & Sam's Anniversary" rendering -- otherwise the dedupe above
      // makes the email read as one partner's alone for half of every
      // couple, by construction.
      //
      // PER RECIPIENT (see recipientSeesPartner above): both names only for a
      // recipient who shares a group with each partner. For anyone else the
      // copy names only the partner they can see, which is the single-name
      // form every unlinked celebrant already gets -- celebrant_username, the
      // value this pipeline has always used for a single name, so a couple's
      // partner-side viewer and an unlinked celebrant's viewer read alike.
      // The occasion, the date and the links are unchanged; only the rendered
      // name differs, and all five surfaces it feeds (subject in
      // lib/resend/send.tsx, plus body, heading, wishlist button and footer in
      // DateReminderEmail.tsx) follow from this one value.
      const partnerId = partnerIdByCanonicalCelebrantId.get(dateInfo.celebrant_id);
      const celebrantName =
        dateInfo.field_name === 'anniversary' &&
        partnerId &&
        recipientSeesPartner(dateInfo.notified_user_id, partnerId)
          ? coupleCelebrantName(
              coupleProfilesById,
              dateInfo.celebrant_id,
              dateInfo.celebrant_username,
              partnerId
            )
          : dateInfo.celebrant_username;

      // Create notification record first
      const { data: notification, error: notificationError } = await supabase
        .from('date_notifications')
        .insert({
          notified_user_id: dateInfo.notified_user_id,
          celebrant_id: dateInfo.celebrant_id,
          field_name: dateInfo.field_name,
          group_id: dateInfo.group_id,
          celebration_date: dateInfo.celebration_date,
          notification_year: currentYear,
          email_sent: false,
          banner_shown: true,
        })
        .select()
        .single();

      if (notificationError) {
        console.error('Error creating notification:', notificationError);
        errors.push({
          email: dateInfo.notified_user_email,
          error: notificationError.message,
        });
        continue;
      }

      // Send email.
      //
      // See the note in lib/actions/invitations.ts: the Resend SDK resolves to
      // `{ data: null, error }` for API-level rejections and throws only on a
      // network fault. With just the catch, this loop counted every rejected
      // send as delivered -- reporting `sent: N` for mail that never left, and
      // writing email_sent = true behind it, so the row said the reminder had
      // gone out and no retry would ever pick it up.
      try {
        const { error: sendError } = await sendDateReminderEmail({
          toEmail: dateInfo.notified_user_email,
          recipientName: dateInfo.notified_user_email.split('@')[0], // Fallback, could be improved
          celebrantName,
          celebrantUsername: dateInfo.celebrant_username,
          celebrantUserId: dateInfo.celebrant_id,
          dateType: dateInfo.field_name as 'birthday' | 'anniversary',
          celebrationDate: formatMonthDay(dateInfo.field_value),
          groupName: dateInfo.group_name,
          groupType: dateInfo.group_type,
        });

        if (sendError) {
          console.error('Resend rejected the reminder email:', sendError);
          errors.push({
            email: dateInfo.notified_user_email,
            error: sendError.message || 'Failed to send email',
          });
          // Leaves email_sent = false on the row just inserted, which is the
          // point: the reminder is still outstanding.
          continue;
        }

        // Update notification record to mark email as sent
        await supabase
          .from('date_notifications')
          .update({
            email_sent: true,
            email_sent_at: new Date().toISOString(),
          })
          .eq('id', notification.id);

        sentCount++;
      } catch (emailError) {
        console.error('Error sending reminder email:', emailError);
        errors.push({
          email: dateInfo.notified_user_email,
          error: emailError instanceof Error ? emailError.message : 'Failed to send email',
        });
      }
    } catch (error) {
      console.error('Error processing date reminder:', error);
      errors.push({
        email: dateInfo.notified_user_email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    sent: sentCount,
    total: upcomingDates.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Get active date reminders for the current user
 * Shows banners for dates happening today
 */
export async function getActiveDateReminders() {
  try {
    const supabase = await createClient();

    // Get current user
    const userId = await getUserId();

    if (!userId) {
      return { error: "Not authenticated", data: [] };
    }

    // Get today's date reminders that haven't been dismissed
    const { data: reminders, error: remindersError } = await supabase
      .rpc('get_dates_today_for_user', { p_user_id: userId });

    if (remindersError) {
      // Pull the fields out by hand rather than logging the object. An Error
      // instance carries message/stack as NON-ENUMERABLE properties, so
      // `console.error(msg, err)` renders it as `{}` in the Next overlay and
      // the actual cause is lost -- which is exactly how this failure
      // presented before.
      const detail = {
        message: remindersError.message ?? null,
        code: (remindersError as { code?: string }).code ?? null,
        details: (remindersError as { details?: string }).details ?? null,
        hint: (remindersError as { hint?: string }).hint ?? null,
      };
      const errorMessage = detail.message ?? '';

      if (errorMessage.includes('function') && errorMessage.includes('does not exist')) {
        console.warn('Date reminders feature not yet set up. Please run the database migration.');
        return { data: [] }; // Return empty array silently
      }

      // 42501 on a function granted to `authenticated` means the request
      // arrived as `anon` -- the Clerk token was not accepted. Supabase trusts
      // a fixed set of Clerk issuers, so this is what a local environment
      // pointed at a Clerk instance Supabase does not know looks like. Worth
      // naming: RLS *tables* fail the same way but silently, returning zero
      // rows that are indistinguishable from an empty account.
      if (detail.code === '42501') {
        console.error(
          'Date reminders: permission denied, so the request reached Postgres as `anon` ' +
            'rather than `authenticated`. The Clerk token was rejected -- check that this ' +
            "environment's Clerk domain is registered under Supabase -> Authentication -> " +
            'Third Party Auth.',
          detail
        );
        return { data: [] };
      }

      console.error('Error fetching date reminders:', detail);
      return { data: [] }; // Return empty array to prevent UI crash
    }

    return { data: reminders || [] };
  } catch (error) {
    console.error('Unexpected error in getActiveDateReminders:', error);
    return { data: [] }; // Fail gracefully
  }
}

/**
 * Dismiss a date reminder banner
 */
export async function dismissDateReminder(notificationId: string) {
  const supabase = await createClient();

  // Get current user
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Update notification to mark banner as dismissed
  const { error: updateError } = await supabase
    .from('date_notifications')
    .update({
      banner_dismissed: true,
      banner_dismissed_at: new Date().toISOString(),
    })
    .eq('id', notificationId)
    .eq('notified_user_id', userId); // Ensure user can only dismiss their own notifications

  if (updateError) {
    console.error('Error dismissing reminder:', updateError);
    return { error: updateError.message };
  }

  return { success: true };
}

/**
 * Manually trigger reminder check (for testing).
 *
 * Has no callers; /api/cron/check-date-reminders does the same job with a
 * URL you can open. Kept as the programmatic form, but it is a second door
 * onto the same service-role read, so it carries the same lock: NODE_ENV was
 * never a check, it was a hope that NODE_ENV is what you think it is on the
 * host you are deployed to. The secret is what decides.
 */
export async function manualTriggerReminders(
  cronSecret: string | undefined,
  daysAhead: number = 1
) {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Manual trigger only available in development' };
  }

  return await checkAndSendDateReminders(cronSecret, daysAhead);
}
