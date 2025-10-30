# Supabase Production Migration Checklist

**CRITICAL:** All migrations must be applied to your production Supabase database before deploying to Vercel.

## Instructions

1. Go to your Supabase Dashboard → SQL Editor
2. Click "New Query"
3. Copy the contents of each migration file below (in order)
4. Paste into the SQL Editor
5. Click "Run" or press `Ctrl+Enter` / `Cmd+Enter`
6. Verify "Success. No rows returned" or similar success message
7. Check the box when complete
8. Move to next migration

## Migration Files (Apply in This Order)

### Phase 1: Core Infrastructure
- [ ] `20250122_create_groups.sql` - Create groups table and basic structure
- [ ] `20250123000000_create_user_profiles.sql` - User profiles with privacy controls
- [ ] `20250124000000_fix_rls_recursion.sql` - Fix RLS policy recursion issues

### Phase 2: Privacy System
- [ ] `20250125000000_update_privacy_to_array.sql` - Update privacy to array format
- [ ] `20250125000001_fix_privacy_constraint.sql` - Fix privacy constraints
- [ ] `20250125000002_fix_group_creation_rls.sql` - Fix group creation RLS
- [ ] `20250125000003_temporarily_disable_groups_rls.sql` - Temporary RLS disable
- [ ] `20250125000004_reenable_groups_rls.sql` - Re-enable groups RLS

### Phase 3: Wishlist System
- [ ] `20250126000001_create_wishlist_fixed.sql` - Create wishlist tables

### Phase 4: Gift Coordination
- [ ] `20250127000000_create_gift_groups.sql` - Create gift coordination groups
- [ ] `20250127000001_fix_gift_group_rls.sql` - Fix gift group RLS
- [ ] `20250127000002_fix_gift_group_insert_rls.sql` - Fix insert RLS
- [ ] `20250127000003_fix_gift_group_select_rls.sql` - Fix select RLS
- [ ] `20250127000004_enable_realtime_messages.sql` - Enable real-time chat
- [ ] `20250128000000_rename_gift_groups_to_group_gifts.sql` - Rename tables

### Phase 5: Gift Exchange (Secret Santa)
- [ ] `20250129000000_create_gift_exchanges.sql` - Create gift exchange system

### Phase 6: RLS Optimization
- [ ] `20250130000000_fix_group_gifts_rls.sql` - Fix group gifts RLS
- [ ] `20250130000001_fix_group_gift_members_rls.sql` - Fix members RLS
- [ ] `20250130000002_rebuild_group_gifts_rls.sql` - Rebuild RLS policies
- [ ] `20250130000003_fix_rls_recursion.sql` - Fix RLS recursion (2nd pass)
- [ ] `20250130000004_simple_rls_no_recursion.sql` - Simplified RLS

### Phase 7: Wishlist Privacy Updates
- [ ] `20250131000000_update_wishlist_privacy.sql` - Update wishlist privacy format
- [ ] `20250131000001_update_wishlist_privacy_to_group_types.sql` - Group types format
- [ ] `20250131000003_debug_wishlist_privacy.sql` - Debug and fix wishlist privacy

### Phase 8: Date Reminders (NEW FEATURE)
- [ ] `20250201000000_create_date_reminders.sql` - Create date reminders system
- [ ] `20250201000001_fix_get_dates_today_function.sql` - Fix SQL function
- [ ] `20250201000002_fix_wishlist_privacy_data.sql` - Fix wishlist data
- [ ] `20250201000003_add_wishlist_privacy_constraint.sql` - Add privacy constraints

## Verification

After applying all migrations, run this query to verify:

```sql
-- Check all tables exist
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

**Expected tables (at minimum):**
- `date_notifications`
- `gift_exchange_participants`
- `gift_exchanges`
- `group_gift_members`
- `group_gifts`
- `group_members`
- `groups`
- `invitations`
- `messages`
- `profile_info`
- `user_profiles`
- `wishlist_items`

## Check Functions

```sql
-- Verify key functions exist
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_type = 'FUNCTION'
ORDER BY routine_name;
```

**Expected functions (at minimum):**
- `can_view_field`
- `can_view_wishlist_item`
- `cleanup_privacy_overrides_on_group_delete`
- `cleanup_privacy_overrides_on_group_member_delete`
- `get_dates_today_for_user`
- `get_shared_groups`
- `get_upcoming_dates_for_notifications`

## Check RLS Policies

```sql
-- Verify RLS is enabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

All tables should show `rowsecurity = true`.

## Common Issues

### Issue: "relation already exists"
**Solution:** This migration was already applied. Skip to next one.

### Issue: "function does not exist"
**Solution:** You may have skipped a migration. Go back and check which one.

### Issue: "permission denied"
**Solution:** Ensure you're running the query as the database owner (should be automatic in Supabase SQL Editor).

### Issue: "check constraint violated"
**Solution:** There may be existing data that doesn't match the new format. The migration should handle this, but if not, check the specific migration for data cleanup steps.

## Migration Time Estimate

- Total migrations: 28
- Estimated time per migration: 1-2 minutes
- **Total time: 30-60 minutes**

## Success Criteria

- [ ] All 28 migrations applied without errors
- [ ] All expected tables exist
- [ ] All expected functions exist
- [ ] RLS enabled on all tables
- [ ] No errors when running verification queries

## Ready for Deployment

Once all boxes are checked and verification passes:
✅ Your database is ready for production deployment!

Proceed to [VERCEL_DEPLOYMENT_GUIDE.md](./VERCEL_DEPLOYMENT_GUIDE.md)
