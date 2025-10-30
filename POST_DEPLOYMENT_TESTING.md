# Post-Deployment Testing Checklist

Complete this checklist after deploying to Vercel to ensure all features work correctly in production.

**Production URL:** `https://[your-project].vercel.app` (update after deployment)

## Pre-Testing Setup

- [ ] Clear browser cache and cookies
- [ ] Use incognito/private browsing for clean test
- [ ] Have a test email address ready (for registration)
- [ ] Have browser developer tools open (Console tab)

## Section 1: Basic Functionality

### 1.1 Homepage & Navigation
- [ ] Homepage loads at `/`
- [ ] No console errors in browser dev tools
- [ ] All navigation links work
- [ ] Theme toggle works (light/dark mode)
- [ ] Logo/branding displays correctly

### 1.2 Static Pages
- [ ] `/login` loads correctly
- [ ] `/register` loads correctly
- [ ] `/verify-email` loads correctly
- [ ] All forms display properly

## Section 2: Authentication Flow

### 2.1 User Registration
- [ ] Navigate to `/register`
- [ ] Fill out registration form with test email
- [ ] Submit form (should succeed)
- [ ] Verify redirect to email verification page
- [ ] Check test email inbox
- [ ] Welcome email received ✉️
- [ ] Email contains verification link
- [ ] Click verification link
- [ ] Successfully redirected back to app
- [ ] Account verified message shown

### 2.2 Login
- [ ] Navigate to `/login`
- [ ] Enter test credentials
- [ ] Click "Login"
- [ ] Successfully redirected to `/dashboard`
- [ ] User profile loaded
- [ ] No authentication errors in console

### 2.3 Protected Routes
- [ ] Open new incognito window
- [ ] Try accessing `/dashboard` without login
- [ ] Redirected to `/login` ✅
- [ ] Try accessing `/groups` without login
- [ ] Redirected to `/login` ✅
- [ ] Login redirects back to attempted page

### 2.4 Logout
- [ ] Click logout button
- [ ] Redirected to homepage or login
- [ ] Session cleared (cannot access `/dashboard`)
- [ ] Try accessing protected route
- [ ] Correctly redirected to login

## Section 3: Profile Management

### 3.1 Profile Viewing
- [ ] Navigate to `/profile`
- [ ] Profile information displays
- [ ] Avatar displays (if set)
- [ ] Username and display name shown

### 3.2 Profile Editing
- [ ] Click "Edit Profile"
- [ ] All form fields load correctly
- [ ] Update bio
- [ ] Update display name
- [ ] Add phone number or other personal info
- [ ] Click "Save"
- [ ] Success message shown
- [ ] Changes persist after refresh

### 3.3 Privacy Settings
- [ ] Edit profile privacy settings
- [ ] Set field privacy to "Private"
- [ ] Set field privacy to "Group"
- [ ] Set field privacy to "Family"
- [ ] Save and verify settings persist
- [ ] Test with another account (if available)

### 3.4 Important Dates
- [ ] Navigate to Profile Edit → Dates section
- [ ] Add birthday (use today's date for testing)
- [ ] Add anniversary (optional)
- [ ] Set privacy to allow groups to see
- [ ] Save successfully
- [ ] Verify dates saved correctly

## Section 4: Groups

### 4.1 Group Creation
- [ ] Navigate to `/groups`
- [ ] Click "Create Group"
- [ ] Fill out group form:
  - [ ] Group name
  - [ ] Description
  - [ ] Type (family/friends/work/custom)
- [ ] Submit form
- [ ] Success message shown
- [ ] Redirected to group page
- [ ] Group details display correctly

### 4.2 Group Invitations
- [ ] On group page, click "Invite Members"
- [ ] Enter test email address
- [ ] Send invitation
- [ ] Success message shown
- [ ] Check test email inbox
- [ ] Invitation email received ✉️
- [ ] Email contains invitation link
- [ ] Email shows correct group name
- [ ] Open invitation link (new browser/incognito)
- [ ] Invitation page loads
- [ ] Accept invitation (create account if needed)
- [ ] Successfully joined group

### 4.3 Group Management
- [ ] View group members list
- [ ] Copy invite code
- [ ] View group settings
- [ ] Update group description
- [ ] Save changes successfully
- [ ] Leave group (use test account)
- [ ] Rejoin group using invite code

## Section 5: Wishlist

### 5.1 Creating Wishlist Items
- [ ] Navigate to `/wishlist`
- [ ] Click "Add Item"
- [ ] Fill out item form:
  - [ ] Title
  - [ ] Description
  - [ ] URL (optional)
  - [ ] Price
  - [ ] Priority (low/medium/high/must-have)
  - [ ] Category
- [ ] Set privacy settings
- [ ] Submit form
- [ ] Item appears in wishlist
- [ ] All details display correctly

### 5.2 Wishlist Privacy
- [ ] Edit wishlist item
- [ ] Change privacy to specific group
- [ ] Save changes
- [ ] View as another user (if available)
- [ ] Verify privacy respected

### 5.3 Wishlist Viewing
- [ ] View own wishlist
- [ ] View another user's wishlist (if in shared group)
- [ ] Respect privacy settings
- [ ] Claim item (as other user)
- [ ] Mark as purchased

## Section 6: Gift Coordination

### 6.1 Group Gifts
- [ ] Navigate to `/gifts`
- [ ] Create new group gift
- [ ] Set target amount
- [ ] Invite members
- [ ] Members receive notification/invitation
- [ ] Add contribution
- [ ] Progress bar updates
- [ ] Chat message sent
- [ ] Real-time chat works

### 6.2 Gift Exchange (Secret Santa)
- [ ] Navigate to `/gift-exchange`
- [ ] Create new gift exchange
- [ ] Set budget range
- [ ] Set exchange date
- [ ] Invite participants
- [ ] Participants register
- [ ] Assignments generated (after deadline)
- [ ] View assignment (when revealed)
- [ ] Assignment is correct (no self-assignment)

## Section 7: Date Reminders (NEW FEATURE)

### 7.1 Manual Cron Trigger (Development Only)
**Note:** Only works in development mode

```bash
curl https://[your-project].vercel.app/api/cron/check-date-reminders?days=0
```

- [ ] Command executes without error
- [ ] Returns success response

### 7.2 Automated Cron (Production)
- [ ] Check Vercel Dashboard → Cron Jobs
- [ ] Verify cron job listed
- [ ] Schedule shows "0 9 * * *"
- [ ] Status shows "Active"
- [ ] Wait for scheduled execution (9 AM UTC)
- [ ] Check execution logs
- [ ] Verify no errors

### 7.3 Date Reminder Emails
**Prerequisites:** Birthday set to today in profile

- [ ] Wait for cron execution (or trigger manually)
- [ ] Group members receive email ✉️
- [ ] Email shows celebrant name
- [ ] Email shows date type (birthday/anniversary)
- [ ] Email shows group name
- [ ] Email contains links to profile & wishlist
- [ ] Links work correctly

### 7.4 Date Reminder Banners
- [ ] Login to account
- [ ] Navigate to `/dashboard`
- [ ] Banner appears for today's birthday ✅
- [ ] Banner shows celebrant name
- [ ] Banner shows date type
- [ ] Banner shows group context
- [ ] Click "Dismiss" button
- [ ] Banner disappears
- [ ] Banner stays dismissed after refresh

## Section 8: API Routes

### 8.1 Cron Endpoint Security
**Test in production mode:**

```bash
# Without auth (should fail)
curl -X POST https://[your-project].vercel.app/api/cron/check-date-reminders

# Expected: 401 Unauthorized
```

- [ ] Returns 401 without CRON_SECRET
- [ ] Returns proper error message

### 8.2 Auth Callback
- [ ] OAuth flow works (tested in auth section)
- [ ] Handles redirects correctly
- [ ] No errors in Vercel function logs

## Section 9: Performance & Monitoring

### 9.1 Page Load Performance
- [ ] Homepage loads in < 3 seconds
- [ ] Dashboard loads in < 3 seconds
- [ ] No slow queries or timeouts
- [ ] Images load properly
- [ ] No layout shift (CLS)

### 9.2 Vercel Logs
- [ ] Go to Vercel → Logs
- [ ] No error logs
- [ ] All functions executing successfully
- [ ] No timeout errors

### 9.3 Supabase Logs
- [ ] Go to Supabase → Logs
- [ ] No authentication errors
- [ ] No RLS policy violations
- [ ] All queries executing successfully

## Section 10: Edge Cases & Error Handling

### 10.1 Invalid Routes
- [ ] Navigate to `/nonexistent-page`
- [ ] Shows 404 page
- [ ] 404 page styled correctly
- [ ] Can navigate back to app

### 10.2 Invalid Forms
- [ ] Try submitting empty forms
- [ ] Validation errors shown
- [ ] Error messages clear
- [ ] No console errors

### 10.3 Offline Behavior
- [ ] Disconnect internet
- [ ] Try loading page
- [ ] Shows appropriate error
- [ ] Reconnect
- [ ] App recovers gracefully

## Section 11: Browser Compatibility

Test in multiple browsers:

### Chrome/Edge
- [ ] All features work
- [ ] No console errors
- [ ] Visual rendering correct

### Firefox
- [ ] All features work
- [ ] No console errors
- [ ] Visual rendering correct

### Safari (if available)
- [ ] All features work
- [ ] No console errors
- [ ] Visual rendering correct

## Section 12: Mobile Responsiveness

Test on mobile device or browser dev tools mobile view:

- [ ] Homepage responsive
- [ ] Login/register forms usable
- [ ] Dashboard displays correctly
- [ ] Navigation works on mobile
- [ ] Forms submit correctly
- [ ] No horizontal scroll
- [ ] Touch targets large enough

## Final Verification

### Vercel Dashboard Checks
- [ ] All deployments successful
- [ ] No failed deployments
- [ ] Cron job active
- [ ] No function errors
- [ ] Analytics showing traffic (if enabled)

### Supabase Dashboard Checks
- [ ] Database size reasonable
- [ ] Query performance good
- [ ] No auth errors
- [ ] RLS working correctly
- [ ] Real-time subscriptions active

### Resend Dashboard Checks
- [ ] All emails delivered
- [ ] No bounce/spam reports
- [ ] Delivery rate 100% (or close)
- [ ] No API errors

## Critical Issues

If any of these fail, **DO NOT** proceed to production:

- [ ] ❌ Authentication completely broken
- [ ] ❌ Database not accessible
- [ ] ❌ Emails not sending at all
- [ ] ❌ Build failures
- [ ] ❌ Security vulnerabilities exposed

## Known Issues (Non-Blocking)

Document any minor issues that don't block launch:

1. _[Issue description]_
   - Severity: Low/Medium/High
   - Workaround: _[If any]_
   - Fix planned: Yes/No

## Sign-Off

Testing completed by: ________________
Date: ________________
All critical features working: ✅ / ❌
Ready for production: ✅ / ❌

## Next Steps After Testing

If all tests pass:
- [ ] Update README with production URL
- [ ] Update documentation
- [ ] Notify team of launch
- [ ] Monitor for first 24-48 hours
- [ ] Address any user-reported issues

If tests fail:
- [ ] Document failures
- [ ] Create GitHub issues for bugs
- [ ] Fix critical issues
- [ ] Re-test
- [ ] Redeploy
