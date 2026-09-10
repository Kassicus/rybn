-- -----------------------------------------------------------------------------
-- Drop link_fetch_log.
--
-- The table existed only to rate-limit the "paste a URL and fill in the item"
-- feature, which has been removed. It held one row per outbound fetch per user
-- and had no other reader.
--
-- The feature was removed because it could not do the job for the retailers
-- people actually paste. Amazon answers a server-side request with a 503 and a
-- note directing you to their Marketplace APIs, and serves a bot wall even to a
-- full browser User-Agent -- the block is on datacenter IP ranges, not headers.
-- Etsy answers 403. What came back was a title and nothing else, which is worse
-- than an honest empty form.
--
-- Nothing else references this table, so the drop is unconditional rather than
-- deferred behind a rename.
-- -----------------------------------------------------------------------------

drop table if exists public.link_fetch_log;
