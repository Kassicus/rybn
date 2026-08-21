-- Check current policies on group_gifts
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'group_gifts' 
ORDER BY policyname;
