# Rybn mobile app — overview

**Status:** agreed in chat 2026-11-10. This records the whole picture. It is
not a build spec: each piece below gets its own design, then its own plan.
**First piece:** `_planning/2026-11-10-mobile-foundation-design.md`.
**Modelled on:** the Wilde Plant and Floral pair, `~/Documents/github/wpfc-web`
and `~/Documents/github/wpfc-mobile`, and its founding design at
`wpfc-mobile/docs/superpowers/specs/2026-10-03-mobile-foundation-design.md`.

Throughout, **(owner)** marks something Kason said. **(call)** marks a choice
made while designing that he has not been asked about directly; he saw most of
them in sketches or summaries and did not object.

## Why

- (owner) The app will get more use than the site. Most people are not at a
  desktop most of the time. The app becomes the main way people use rybn and
  the site becomes the companion.
- (owner) Today's users are family and friends. Use centres on the family
  group and wishlists, heavily around Christmas, and little else yet. The
  recent occasions work (better special occasions, next holiday) is a hope for
  broader use, not what people come for today.
- (owner) iPhone first. Nobody using rybn is on Android. An Android app gets
  built only if usage grows beyond family and friends.
- (owner) On TestFlight before Christmas 2026 would be ideal. Last year was
  web-only and fine, so there is no hard deadline; sooner is better.

This is the opposite of Wilde in one respect. Wilde's app mirrors part of a
website for staff who already have accounts. Rybn's app is where most people
will meet the product, so over time its API has to cover nearly everything.

## Goals

1. A family member can run the whole Christmas loop from their phone without
   opening the site: see what is coming up, see who they have and have not
   started shopping for, open someone's list, claim an item, follow it through
   to given, and add to their own list.
2. Adding an item to your own list takes no copying and pasting.
3. Every rule stays in one place, on the website, so the app and the site
   cannot disagree and a later Android app reuses the same API.

## Non-goals for now

- (owner) Notifications. "Keep it chill for now"; they come later.
- (owner) Android. (call) iPad.
- (call) The public App Store listing, and what Apple requires of a public
  consumer app: sign-up in the app, Sign in with Apple (required once Google
  sign-in is offered), in-app account deletion.
- (call) Everything else the site does: group gifts and their chat, gift
  exchanges, creating and managing groups, invitations, anniversary links,
  detailed profile and privacy editing.
- (call) A dark theme. The site is light-only by design
  (`app/globals.css`, README "Light only, deliberately").

## Anti-goals

These are (call), inferred from how the site is built. A build that breaks one
has failed even if it works.

- The owner of a wishlist must never learn from the app that something on it
  has been claimed or bought. The site already guarantees this.
- The app must not carry its own copy of a rule the site enforces.
- No TestFlight build ships a tab or button that leads nowhere.

## How it is put together

All (call) unless marked, following Wilde:

- Two repos. `rybn` stays the Next.js site. A new `rybn-mobile` holds a native
  SwiftUI iPhone app.
- The app signs in with Clerk's iOS SDK, then does every read and write through
  `/api/mobile/v1/*` on the website, sending its Clerk session token as a
  bearer token. It never talks to Supabase.
- One deliberate exception: for the share flow the phone itself fetches a
  shop's page to build a link preview. That is the point of the feature (see
  "What the link test found").
- Both repos keep copies of the same JSON fixtures for each response shape and
  both test suites check them.

Rejected:

- **Talking to Supabase from the app.** Rybn's RLS is real access control, so
  this would be safer than it was at Wilde, but the actions also sign image
  URLs, send email, validate input and in places use the service-role client
  after their own checks. The app would have to repeat all of it, and so would
  an Android app.
- **A web wrapper.** Rybn had one (Capacitor, bundle ID `app.rybn.ios`),
  removed in commit `4d89183` with the Clerk migration.
- **A cross-platform toolkit.** No Android users to serve, and the share sheet
  and native feel matter here.

## The pieces, in order

(owner) agreed this order.

1. **Foundation.** The `rybn-mobile` repo, sign-in, the mobile API wrapper on
   the website, the app shell, the TestFlight path. Wilde's foundation without
   push.
2. **My wishlist.** Your list, adding and editing, and the share sheet. Second
   because people fill their lists before anyone shops, and because the share
   sheet is the riskiest part and should meet a real phone early.
3. **Shopping.** The occasion-first home, the group page, a person's list,
   claim and track, the Gifts tab, and the database addition below.

Later, in no agreed order: notifications; the public App Store release; the
rest of the site's features.

## Screens agreed

Sketches of all of these are in
`.superpowers/brainstorm/33806-1794369226/content/` (git-ignored, on Kason's
Mac only): `home-layout.html`, `home-and-group.html`, `share-flow.html`,
`claim-and-track.html`, `share-test-results.html`. They are throwaway sketches
in the site's colours and type with made-up names. Treat them as intent, not
as pixel references.

**Tab bar.** Home, Groups, Gifts, Wishlist, Account. (call) A tab appears in
the build that makes it work, so the foundation ships Home and Account only.

**Home, occasion-first.** (owner) picked this over a grid of faces and over a
list of rows, because it shows "which holiday is next and who you have and
haven't started shopping for".

- The soonest upcoming occasion leads, in an evergreen card: its name, how many
  days away, the date.
- When it belongs to a whole group (a group date such as Christmas), everyone
  in that group except you is listed under "Shopping for", each with where you
  stand: a count of what you have claimed, or "Nothing yet". A progress line
  reads "Started for 2 of 5 people". Tapping a person opens their list.
- When it belongs to one or two people (a birthday or anniversary), the card
  shows just them, with a button to their list.
- Later occasions sit underneath as rows and keep their own progress, so
  Christmas still reads "2 of 5 started" while a birthday is ahead of it.
- (call) Home always leads with whatever is soonest, even a single birthday
  three weeks before Christmas.

**Group page.** (owner) asked for the faces grid here: "we should save that for
how we display group members on the group pages". Everyone in the group as a
three-column grid of avatar tiles with their name and item count. (call) A
tick marks people you have claimed something for. The group's own upcoming
dates sit underneath.

**A person's list.** (call) What you have already claimed for them is on top
under "Your gifts for {name}", each with its status, marked as visible only to
you. The rest of their list is underneath. An available item has a Claim
button; claiming moves it up. An item someone else holds reads "Taken" and
(call) does not say who, although the site's data knows.

**One gift.** (owner) described the flow: claim so nobody else buys it, order
from the link when ready, then follow it through ordered, arrived, wrapped,
gifted. (owner) Today he copies the item into the gift tracker by hand to do
that. The screen: picture, name, who it is for and which occasion, price,
"Open in shop", then the five steps (claimed, ordered, arrived, wrapped,
given) with one button for the next step, and "Release this claim".

- (owner) agreed claiming and tracking become one thing, with the database
  addition below.
- (call) Marking a gift ordered also marks the wishlist item purchased, which
  is what tells other shoppers it is bought on the site today
  (`markAsPurchased` in `lib/actions/wishlist.ts`).

**Gifts tab.** The tracker: everything you have claimed, grouped by person,
with a season picker and a count by status. (owner) The tracker is nearly
always claimed items; "sometimes I'll manually add something if I got
something for someone and it wasn't from their list", so there is an "Add a
gift that wasn't on a list" button.

**My wishlist.** Your items, newest first, with a + button. (call) + takes a
pasted link and fills in the same way as the share sheet; typing by hand and
taking a photo still work.

**Share sheet.** (owner) Adding from Amazon today means copying the link, the
details and the picture by hand, and on a phone that would mean swapping apps
and long-pressing. So: in any shop, tap Share and pick Rybn. Rybn's sheet
comes up over the shop with the name, picture and link already filled. You
choose how much you want it and who can see it (the two fields the site treats
as real decisions) and save, without leaving the shop.

- (owner) confirmed the Amazon app's share hands over a link and a name.
- (call) Price is offered when one is found, marked "check it", and blank
  when not.
- (call) Amazon's picture arrives inside its own framed share card; crop the
  frame away.
- (call) Description and category stay on the full edit screen.

## What the link test found

A throwaway program run on 2026-11-10 from Kason's Mac asked each shop two
ways: through Apple's link preview (`LPMetadataProvider`, what Messages uses)
and with a plain `URLSession` fetch carrying an iPhone Safari User-Agent.

| Shop | Links | Name | Picture | Price in the page |
|---|---|---|---|---|
| Amazon | 3 | 3 | 3 | 2 |
| Etsy | 2 | 2 | 2 | 2 |
| Target | 1 | 1 | 1 | 0 |
| LEGO | 1 | 1 | 1 | 1 |

- Every link answered in about two seconds.
- Etsy answered `curl` with 403 and the `URLSession` request with 200. Amazon
  answered all three. This is the block that removed the site's own auto-fill
  in commit `faa4030`: it is on datacenter addresses, not on phones.
- Name and picture came from the link preview. Amazon has no `og:image`; its
  preview picture is a 1024x536 share card with a dark green frame around the
  product photo.
- Price is unreliable. Taking the first price-looking string on an Amazon page
  gave $15.99 for a $29.99 bottle. Reading the page's `"priceAmount"` field
  gave the right number on two Amazon pages and nothing on the third. Target's
  page yielded none.

Not tested: a real iPhone; the code running inside a share extension; Amazon's
short `a.co` links.

The test program was throwaway and is not in either repo.

## Data change agreed

(owner) "Let's make the addition." Today a claim (`wishlist_claims`) and a
tracked gift (`tracked_gifts`) are separate rows with no link, and tracker
recipients (`gift_recipients`) are typed names, not people. Piece 3 adds
nullable columns that link a tracked gift to the wishlist item or claim it
came from, and a recipient to the person it stands for. Purely additive, so
the site keeps working unchanged. The exact columns belong to piece 3's design.

## Questions carried to later designs

**Piece 2, my wishlist**

- How the share extension shares the app's Clerk sign-in. The Clerk iOS pages
  read for this design do not cover Keychain access groups or extensions. Prove
  it on a real phone before designing around it.
- Where the picture goes. A link preview hands over image bytes, not a URL, and
  the site uploads straight from the browser to Supabase storage
  (`components/ui/image-input.tsx`). The app needs an upload route.
- Short links, and how far to go on per-shop price rules.

**Piece 3, shopping**

- The exact rule for "started". On the site a claim can be labelled with a
  birthday or anniversary but not with a group date such as Christmas
  (`claimItem` in `lib/actions/claims.ts`), and a claim on a purchased item
  stays active forever (`lib/claims/active.ts`), so last year's gifts must not
  count toward this year's progress.
- Whether "Taken" should say who.
- How existing typed recipients map onto people, and what happens to the
  tracked gift when a claim is released.
- Which occasion leads when someone is in several groups.

**Later**

- What notifications announce.
- How gift chat works in the app; on the site it listens to Supabase Realtime
  from the browser (`components/gifts/ChatWindow.tsx`).
