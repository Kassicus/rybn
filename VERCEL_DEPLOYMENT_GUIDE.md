# Vercel Deployment Guide

This guide will walk you through deploying the Rybn application to Vercel.

## Prerequisites

- [ ] GitHub repository with latest code pushed
- [ ] Supabase production project created
- [ ] Resend account with verified domain
- [ ] Access to domain registrar (for custom domain)

## Part 1: Pre-Deployment Checklist

### 1.1 Generate CRON_SECRET

Your generated CRON_SECRET (keep this secure):
```
w822ZEAzYZ5tn4GohEG1WDVnvGLtHCIdx8EjN2u5beY=
```

**IMPORTANT:** This value is needed for Vercel environment variables.

### 1.2 Apply Supabase Migrations

**CRITICAL:** All 28 migrations must be applied to your production Supabase database before deploying.

1. Go to your Supabase Dashboard → SQL Editor
2. Click "New Query"
3. Copy and paste each migration file in chronological order:

**Required Migrations (in order):**
1. `20250122_create_groups.sql`
2. `20250123000000_create_user_profiles.sql`
3. `20250124000000_fix_rls_recursion.sql`
4. `20250125000000_update_privacy_to_array.sql`
5. `20250125000001_fix_privacy_constraint.sql`
6. `20250125000002_fix_group_creation_rls.sql`
7. `20250125000003_temporarily_disable_groups_rls.sql`
8. `20250125000004_reenable_groups_rls.sql`
9. `20250126000001_create_wishlist_fixed.sql`
10. `20250127000000_create_gift_groups.sql`
11. `20250127000001_fix_gift_group_rls.sql`
12. `20250127000002_fix_gift_group_insert_rls.sql`
13. `20250127000003_fix_gift_group_select_rls.sql`
14. `20250127000004_enable_realtime_messages.sql`
15. `20250128000000_rename_gift_groups_to_group_gifts.sql`
16. `20250129000000_create_gift_exchanges.sql`
17. `20250130000000_fix_group_gifts_rls.sql`
18. `20250130000001_fix_group_gift_members_rls.sql`
19. `20250130000002_rebuild_group_gifts_rls.sql`
20. `20250130000003_fix_rls_recursion.sql`
21. `20250130000004_simple_rls_no_recursion.sql`
22. `20250131000000_update_wishlist_privacy.sql`
23. `20250131000001_update_wishlist_privacy_to_group_types.sql`
24. `20250131000003_debug_wishlist_privacy.sql`
25. `20250201000000_create_date_reminders.sql`
26. `20250201000001_fix_get_dates_today_function.sql`
27. `20250201000002_fix_wishlist_privacy_data.sql`
28. `20250201000003_add_wishlist_privacy_constraint.sql`

4. Click "Run" for each migration
5. Verify no errors in the output

**Verification:**
```sql
-- Check that key tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Should include: user_profiles, groups, group_members, profile_info,
-- wishlist_items, group_gifts, gift_exchanges, date_notifications
```

### 1.3 Verify Resend Configuration

1. Log into Resend Dashboard
2. Navigate to Domains
3. Verify `hello@rybn.app` has:
   - ✅ Green checkmark (verified)
   - ✅ Valid SPF record
   - ✅ Valid DKIM record
4. Note your API key (starts with `re_`)

## Part 2: Vercel Project Setup

### 2.1 Create Vercel Project

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Configure project:
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** `./`
   - **Build Command:** `npm run build` (leave default)
   - **Output Directory:** `.next` (leave default)
   - **Install Command:** `npm install` (leave default)

5. **DO NOT DEPLOY YET** - Click "Environment Variables" first

### 2.2 Configure Environment Variables

Click "Environment Variables" and add ALL of the following:

**Apply to:** ✅ Production ✅ Preview ✅ Development (check all three)

#### Public Variables

| Name | Value | Example |
|------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | `https://abcdefgh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon public key | `eyJhbGc...` (long string) |
| `NEXT_PUBLIC_APP_NAME` | `Rybn` | `Rybn` |
| `NEXT_PUBLIC_APP_URL` | Your Vercel URL | `https://rybn.vercel.app` |
| `NEXT_PUBLIC_APP_TAGLINE` | `Tied together` | `Tied together` |
| `NEXT_PUBLIC_DEFAULT_THEME` | `light` | `light` |

#### Private Variables (SENSITIVE - DO NOT SHARE)

| Name | Value | Example |
|------|-------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | `eyJhbGc...` (long string, different from anon) |
| `RESEND_API_KEY` | Your Resend API key | `re_123abc...` |
| `CRON_SECRET` | Generated secret from 1.1 | `w822ZEAzYZ...` |
| `EMAIL_FROM_NAME` | `Rybn` | `Rybn` |
| `EMAIL_FROM_ADDRESS` | `hello@rybn.app` | `hello@rybn.app` |
| `EMAIL_SUPPORT` | `support@rybn.app` | `support@rybn.app` |

**Finding Supabase Keys:**
1. Supabase Dashboard → Settings → API
2. Project URL = `NEXT_PUBLIC_SUPABASE_URL`
3. `anon` `public` = `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. `service_role` `secret` = `SUPABASE_SERVICE_ROLE_KEY` ⚠️

### 2.3 Configure Project Settings

1. After adding environment variables, click "Deploy" (or continue if already shown)
2. Wait for initial deployment to complete
3. Go to Project Settings → General
4. Set **Node.js Version:** `20.x`
5. Save changes

## Part 3: Supabase Configuration

### 3.1 Update Allowed Redirect URLs

Your app needs to redirect to Vercel after authentication.

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. Add to **Redirect URLs**:
   ```
   https://[your-project-name].vercel.app/auth/callback
   https://rybn.app/auth/callback
   ```
   Replace `[your-project-name]` with your actual Vercel project name

3. Add to **Site URL**:
   ```
   https://[your-project-name].vercel.app
   ```

4. Save changes

## Part 4: Initial Deployment

### 4.1 Deploy

If you haven't already deployed:
1. In Vercel dashboard, click "Deploy"
2. Wait for build to complete (~3-5 minutes with Turbopack)
3. Watch build logs for any errors

### 4.2 Verify Deployment

1. Once deployed, click "Visit" to open your app
2. You should see the homepage
3. Check Vercel Functions logs for any errors

### 4.3 Verify Cron Job

1. In Vercel dashboard, go to your project
2. Click "Cron Jobs" tab
3. You should see:
   - Path: `/api/cron/check-date-reminders`
   - Schedule: `0 9 * * *` (daily at 9 AM UTC)
   - Status: Active ✅

## Part 5: Post-Deployment Testing

### 5.1 Critical Path Testing

Test each of these in order:

1. **Homepage**
   - [ ] Visit `https://[your-project].vercel.app`
   - [ ] Page loads without errors
   - [ ] No console errors in browser dev tools

2. **Registration**
   - [ ] Click "Register" or navigate to `/register`
   - [ ] Fill out registration form
   - [ ] Submit form
   - [ ] Check email for welcome message
   - [ ] Verify email link works

3. **Login**
   - [ ] Navigate to `/login`
   - [ ] Enter credentials
   - [ ] Successfully redirects to `/dashboard`

4. **Dashboard**
   - [ ] Dashboard loads
   - [ ] Profile information displayed
   - [ ] No errors in console

5. **Profile**
   - [ ] Navigate to Profile → Edit
   - [ ] Add birthday (set to today for testing)
   - [ ] Set privacy to allow groups
   - [ ] Save successfully

6. **Groups**
   - [ ] Create a new group
   - [ ] Invite member via email
   - [ ] Check email received
   - [ ] Accept invitation (use different browser/incognito)

7. **Wishlist**
   - [ ] Add wishlist item
   - [ ] Set privacy settings
   - [ ] Item saves successfully

8. **Date Reminders** (Advanced)
   - [ ] Manually trigger cron (development only):
     ```bash
     curl https://[your-project].vercel.app/api/cron/check-date-reminders?days=0
     ```
   - [ ] Check email for birthday reminder
   - [ ] Verify banner appears on dashboard

### 5.2 Check Vercel Logs

1. Go to Vercel → Your Project → Logs
2. Look for any errors
3. Verify functions are executing without issues

### 5.3 Check Supabase Logs

1. Go to Supabase Dashboard → Logs
2. Filter for API logs
3. Verify no authentication errors
4. Check for any database errors

## Part 6: Custom Domain Setup (rybn.app)

### 6.1 Add Domain to Vercel

1. Vercel → Project → Settings → Domains
2. Click "Add"
3. Enter `rybn.app`
4. Click "Add"
5. Vercel will show DNS configuration

### 6.2 Configure DNS

At your domain registrar (where you bought rybn.app):

1. Add **A Record**:
   - Type: `A`
   - Name: `@` (or blank)
   - Value: `76.76.21.21`
   - TTL: `3600` (or auto)

2. Add **CNAME Record** for www:
   - Type: `CNAME`
   - Name: `www`
   - Value: `cname.vercel-dns.com`
   - TTL: `3600` (or auto)

3. Save DNS changes

**Note:** DNS propagation can take up to 24-48 hours, but usually completes in minutes.

### 6.3 Verify Domain

1. Wait 5-10 minutes
2. In Vercel, your domain should show ✅
3. SSL certificate will be auto-generated
4. Visit `https://rybn.app` to verify

### 6.4 Update Environment Variables

1. Vercel → Project → Settings → Environment Variables
2. Find `NEXT_PUBLIC_APP_URL`
3. Change value from `https://[project].vercel.app` to `https://rybn.app`
4. Save
5. Trigger redeploy (Vercel → Deployments → ... → Redeploy)

### 6.5 Update Supabase Redirect URLs

1. Supabase Dashboard → Authentication → URL Configuration
2. Update **Site URL** to: `https://rybn.app`
3. Ensure redirect URLs include:
   ```
   https://rybn.app/auth/callback
   https://[project].vercel.app/auth/callback (keep for preview deploys)
   ```

## Part 7: Monitoring & Maintenance

### 7.1 Enable Vercel Analytics (Optional)

1. Vercel → Project → Analytics
2. Click "Enable Analytics"
3. Free for Hobby plan

### 7.2 Monitor Cron Jobs

1. Vercel → Project → Cron Jobs
2. View execution history
3. Check for any failures
4. Review execution logs

### 7.3 Set Up Alerts (Recommended)

1. Vercel → Project → Settings → Notifications
2. Enable email notifications for:
   - Deployment failures
   - Deployment succeeded
   - Production branch deployment

### 7.4 Regular Checks

- [ ] Monitor cron job execution daily (first week)
- [ ] Check email delivery success rates in Resend
- [ ] Review Vercel function logs weekly
- [ ] Monitor Supabase usage and performance

## Troubleshooting

### Issue: Build Fails

**Check:**
- TypeScript errors (we have `ignoreBuildErrors: true`)
- Missing environment variables
- Node.js version mismatch

**Solution:**
- Review build logs in Vercel
- Verify all env vars are set
- Ensure Node.js version is 20.x

### Issue: Authentication Redirect Loop

**Cause:** Supabase redirect URLs not configured

**Solution:**
1. Add Vercel URL to Supabase allowed redirect URLs
2. Include `/auth/callback` path
3. Clear browser cookies and try again

### Issue: Cron Job Not Running

**Check:**
- Cron job appears in Vercel dashboard
- CRON_SECRET is set in environment variables
- No errors in function logs

**Solution:**
- Verify `vercel.json` cron configuration
- Check function timeout (may need Pro plan)
- Review cron execution logs

### Issue: Emails Not Sending

**Check:**
- Resend API key is correct
- Domain is verified in Resend
- Email limits not exceeded

**Solution:**
- Test Resend API key manually
- Verify SPF/DKIM records
- Check Resend dashboard for delivery status

### Issue: Database Connection Errors

**Check:**
- Supabase service role key is correct
- All migrations applied
- RLS policies not blocking queries

**Solution:**
- Verify Supabase keys in environment variables
- Re-apply migrations if needed
- Check Supabase logs for specific errors

## Success Checklist

✅ App accessible at production URL
✅ User registration working
✅ Email verification working
✅ Login/logout working
✅ Dashboard accessible
✅ Groups can be created
✅ Invitations send emails
✅ Wishlists working
✅ Profile editing working
✅ Cron job configured and running
✅ Date reminders working
✅ Custom domain configured
✅ SSL certificate active
✅ No errors in Vercel logs
✅ No errors in Supabase logs

## Next Steps

After successful deployment:

1. **Fix TypeScript Errors** - Remove `ignoreBuildErrors: true` from `next.config.ts` and fix the ~57 pre-existing errors
2. **Enable React Compiler** - Install `babel-plugin-react-compiler` and enable for better performance
3. **Add Error Tracking** - Integrate Sentry for production error monitoring
4. **Performance Monitoring** - Review Core Web Vitals in Vercel Analytics
5. **User Testing** - Have team/beta users test all features
6. **Documentation** - Update README with production URL and features

## Support

- **Vercel Docs:** https://vercel.com/docs
- **Next.js 16 Docs:** https://nextjs.org/docs
- **Supabase Docs:** https://supabase.com/docs
- **Resend Docs:** https://resend.com/docs

## Rollback Plan

If critical issues arise:

1. Go to Vercel → Deployments
2. Find the last working deployment
3. Click "..." → "Promote to Production"
4. Fix issues locally
5. Redeploy when ready

## Estimated Deployment Time

- Pre-deployment setup: 30 minutes
- Vercel configuration: 20 minutes
- Database migrations: 15 minutes
- Initial deployment: 10 minutes
- Testing: 30 minutes
- Custom domain: 15 minutes

**Total: ~2 hours**

---

**Generated:** October 29, 2025
**Next.js Version:** 16.0.1
**Node.js Required:** >=20.9.0
