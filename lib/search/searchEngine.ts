"use server";

import { createClient } from "@/lib/supabase/server";
import { calculateRelevance, sortAndLimitResults, groupResultsByType } from "./searchUtils";

export type SearchResultType = "group" | "wishlist" | "gift" | "exchange" | "person";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  description?: string | null;
  metadata?: Record<string, any>;
  url: string;
  relevanceScore?: number;
}

export async function searchSite(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const searchTerm = `%${query.toLowerCase()}%`;
  const results: SearchResult[] = [];

  // Calculate date 30 days from now for upcoming events
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  try {
    // Search People (users in shared groups)
    const { data: people } = await supabase
      .from("user_profiles")
      .select(`
        id,
        username,
        display_name,
        avatar_url
      `)
      .neq("id", user.id)
      .or(`username.ilike.${searchTerm},display_name.ilike.${searchTerm}`);

    if (people) {
      // Filter to only people in shared groups
      for (const person of people) {
        const { data: sharedGroups } = await supabase.rpc("get_shared_groups", {
          user_a: user.id,
          user_b: person.id,
        });

        if (sharedGroups && sharedGroups.length > 0) {
          const relevanceScore = Math.max(
            calculateRelevance(person.username || "", query),
            calculateRelevance(person.display_name || "", query)
          );

          results.push({
            id: person.id,
            type: "person",
            title: person.display_name || person.username,
            description: person.username !== person.display_name ? `@${person.username}` : null,
            metadata: {
              avatar_url: person.avatar_url,
              shared_groups: sharedGroups.length,
            },
            url: `/profile/${person.id}`,
            relevanceScore,
          });
        }
      }
    }

    // Search Groups
    const { data: groups } = await supabase
      .from("group_members")
      .select(`
        groups (
          id,
          name,
          description,
          type
        )
      `)
      .eq("user_id", user.id)
      .ilike("groups.name", searchTerm);

    if (groups) {
      groups.forEach((membership: any) => {
        if (membership.groups) {
          const relevanceScore = calculateRelevance(membership.groups.name, query);
          results.push({
            id: membership.groups.id,
            type: "group",
            title: membership.groups.name,
            description: membership.groups.description,
            metadata: { type: membership.groups.type },
            url: `/groups/${membership.groups.id}`,
            relevanceScore,
          });
        }
      });
    }

    // Search Wishlist Items
    const { data: wishlistItems } = await supabase
      .from("wishlist_items")
      .select("id, title, description, price, url")
      .eq("user_id", user.id)
      .or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`);

    if (wishlistItems) {
      wishlistItems.forEach((item) => {
        const relevanceScore = Math.max(
          calculateRelevance(item.title, query),
          calculateRelevance(item.description || "", query)
        );
        results.push({
          id: item.id,
          type: "wishlist",
          title: item.title,
          description: item.description,
          metadata: { price: item.price, url: item.url },
          url: `/wishlist`,
          relevanceScore,
        });
      });
    }

    // Search Group Gifts
    const { data: groupGifts } = await supabase
      .from("group_gifts")
      .select(`
        id,
        name,
        description,
        target_amount,
        groups (
          id,
          name
        )
      `)
      .or(`name.ilike.${searchTerm},description.ilike.${searchTerm}`);

    if (groupGifts) {
      groupGifts.forEach((gift: any) => {
        const relevanceScore = Math.max(
          calculateRelevance(gift.name, query),
          calculateRelevance(gift.description || "", query)
        );
        results.push({
          id: gift.id,
          type: "gift",
          title: gift.name,
          description: gift.description,
          metadata: {
            target_amount: gift.target_amount,
            group: gift.groups?.name,
          },
          url: `/gifts/${gift.id}`,
          relevanceScore,
        });
      });
    }

    // Search Gift Exchanges (filter for upcoming events in next 30 days)
    const { data: exchanges } = await supabase
      .from("gift_exchanges")
      .select(`
        id,
        name,
        description,
        exchange_date,
        registration_deadline,
        is_active,
        groups (
          id,
          name
        )
      `)
      .or(`name.ilike.${searchTerm},description.ilike.${searchTerm}`)
      .gte("exchange_date", new Date().toISOString())
      .lte("exchange_date", thirtyDaysFromNow.toISOString())
      .eq("is_active", true);

    if (exchanges) {
      exchanges.forEach((exchange: any) => {
        const relevanceScore = Math.max(
          calculateRelevance(exchange.name, query),
          calculateRelevance(exchange.description || "", query)
        );

        const exchangeDate = new Date(exchange.exchange_date);
        const daysUntil = Math.ceil(
          (exchangeDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );

        results.push({
          id: exchange.id,
          type: "exchange",
          title: exchange.name,
          description: exchange.description,
          metadata: {
            exchange_date: exchange.exchange_date,
            registration_deadline: exchange.registration_deadline,
            days_until: daysUntil,
            group: exchange.groups?.name,
          },
          url: `/gift-exchange/${exchange.id}`,
          relevanceScore,
        });
      });
    }
  } catch (error) {
    console.error("Search error:", error);
  }

  // Group by type, sort by relevance, and limit to 5 per type
  const groupedResults = groupResultsByType(results);
  const limitedResults: SearchResult[] = [];

  for (const type in groupedResults) {
    const typeResults = sortAndLimitResults(groupedResults[type as SearchResultType], 5);
    limitedResults.push(...typeResults);
  }

  return limitedResults;
}
