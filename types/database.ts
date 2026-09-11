import type { StoredImageValue } from "./stored-image";

// The two image columns below are declared as StoredImageValue in their Insert
// and Update shapes, not as plain strings. That is deliberate and load-bearing,
// not a typo: it is what makes "a write path forgot the image guard" a compile
// error rather than something a reviewer has to catch. See types/stored-image.ts
// for why, and lib/storage/image-value.ts for the only cast that produces one.
//
// If you regenerate this file, re-apply the four annotations. The tripwire
// assertions in lib/storage/image-value.ts fail to compile if you do not.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      gift_recipients: {
        Row: {
          id: string
          user_id: string
          name: string
          notes: string | null
          is_archived: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          notes?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          notes?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      tracked_gifts: {
        Row: {
          id: string
          user_id: string
          recipient_id: string
          name: string
          description: string | null
          photo_url: string | null
          product_link: string | null
          price: number | null
          status: "planned" | "ordered" | "arrived" | "wrapped" | "given"
          status_changed_at: string
          occasion: string | null
          season_year: number
          notes: string | null
          is_archived: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          recipient_id: string
          name: string
          description?: string | null
          photo_url?: StoredImageValue | null
          product_link?: string | null
          price?: number | null
          status?: "planned" | "ordered" | "arrived" | "wrapped" | "given"
          status_changed_at?: string
          occasion?: string | null
          season_year?: number
          notes?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          recipient_id?: string
          name?: string
          description?: string | null
          photo_url?: StoredImageValue | null
          product_link?: string | null
          price?: number | null
          status?: "planned" | "ordered" | "arrived" | "wrapped" | "given"
          status_changed_at?: string
          occasion?: string | null
          season_year?: number
          notes?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_gifts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_gifts_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "gift_recipients"
            referencedColumns: ["id"]
          }
        ]
      }
      date_notifications: {
        Row: {
          id: string
          notified_user_id: string
          celebrant_id: string
          field_name: string
          group_id: string
          celebration_date: string
          notification_year: number
          email_sent: boolean
          email_sent_at: string | null
          banner_shown: boolean
          banner_dismissed: boolean
          banner_dismissed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          notified_user_id: string
          celebrant_id: string
          field_name: string
          group_id: string
          celebration_date: string
          notification_year: number
          email_sent?: boolean
          email_sent_at?: string | null
          banner_shown?: boolean
          banner_dismissed?: boolean
          banner_dismissed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          notified_user_id?: string
          celebrant_id?: string
          field_name?: string
          group_id?: string
          celebration_date?: string
          notification_year?: number
          email_sent?: boolean
          email_sent_at?: string | null
          banner_shown?: boolean
          banner_dismissed?: boolean
          banner_dismissed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_notifications_celebrant_id_fkey"
            columns: ["celebrant_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_notifications_notified_user_id_fkey"
            columns: ["notified_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      gift_exchange_participants: {
        Row: {
          id: string
          exchange_id: string
          user_id: string
          opted_in: boolean
          assigned_to: string | null
          wishlist_shared: boolean
          gift_sent: boolean
          gift_received: boolean
          notes: string | null
          preferences: string | null
          joined_at: string
        }
        Insert: {
          id?: string
          exchange_id: string
          user_id: string
          opted_in?: boolean
          assigned_to?: string | null
          wishlist_shared?: boolean
          gift_sent?: boolean
          gift_received?: boolean
          notes?: string | null
          preferences?: string | null
          joined_at?: string
        }
        Update: {
          id?: string
          exchange_id?: string
          user_id?: string
          opted_in?: boolean
          assigned_to?: string | null
          wishlist_shared?: boolean
          gift_sent?: boolean
          gift_received?: boolean
          notes?: string | null
          preferences?: string | null
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_exchange_participants_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_exchange_participants_exchange_id_fkey"
            columns: ["exchange_id"]
            isOneToOne: false
            referencedRelation: "gift_exchanges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_exchange_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      gift_exchanges: {
        Row: {
          id: string
          group_id: string
          name: string
          description: string | null
          exchange_type: string
          budget_min: number | null
          budget_max: number | null
          exchange_date: string | null
          exchange_location: string | null
          exchange_details: string | null
          registration_deadline: string | null
          is_active: boolean
          assignments_generated: boolean
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          name: string
          description?: string | null
          exchange_type?: string
          budget_min?: number | null
          budget_max?: number | null
          exchange_date?: string | null
          exchange_location?: string | null
          exchange_details?: string | null
          registration_deadline?: string | null
          is_active?: boolean
          assignments_generated?: boolean
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          name?: string
          description?: string | null
          exchange_type?: string
          budget_min?: number | null
          budget_max?: number | null
          exchange_date?: string | null
          exchange_location?: string | null
          exchange_details?: string | null
          registration_deadline?: string | null
          is_active?: boolean
          assignments_generated?: boolean
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_exchanges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_exchanges_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          }
        ]
      }
      group_gift_members: {
        Row: {
          id: string
          group_gift_id: string
          user_id: string
          contribution_amount: number
          has_paid: boolean
          joined_at: string
        }
        Insert: {
          id?: string
          group_gift_id: string
          user_id: string
          contribution_amount?: number
          has_paid?: boolean
          joined_at?: string
        }
        Update: {
          id?: string
          group_gift_id?: string
          user_id?: string
          contribution_amount?: number
          has_paid?: boolean
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_gift_members_group_gift_id_fkey"
            columns: ["group_gift_id"]
            isOneToOne: false
            referencedRelation: "group_gifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_gift_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      group_gifts: {
        Row: {
          id: string
          group_id: string
          name: string
          description: string | null
          target_user_id: string | null
          target_amount: number | null
          current_amount: number
          is_active: boolean
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          name: string
          description?: string | null
          target_user_id?: string | null
          target_amount?: number | null
          current_amount?: number
          is_active?: boolean
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          name?: string
          description?: string | null
          target_user_id?: string | null
          target_amount?: number | null
          current_amount?: number
          is_active?: boolean
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_gifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_gifts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_gifts_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      group_members: {
        Row: {
          id: string
          group_id: string
          user_id: string
          role: "owner" | "admin" | "member"
          joined_at: string
        }
        Insert: {
          id?: string
          group_id: string
          user_id: string
          role?: "owner" | "admin" | "member"
          joined_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          user_id?: string
          role?: "owner" | "admin" | "member"
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      groups: {
        Row: {
          id: string
          name: string
          description: string | null
          type: "family" | "friends" | "work" | "custom"
          invite_code: string
          settings: Json
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type?: "family" | "friends" | "work" | "custom"
          invite_code: string
          settings?: Json
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: "family" | "friends" | "work" | "custom"
          invite_code?: string
          settings?: Json
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      invitations: {
        Row: {
          id: string
          group_id: string
          email: string
          invited_by: string
          accepted: boolean
          accepted_at: string | null
          token: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          email: string
          invited_by: string
          accepted?: boolean
          accepted_at?: string | null
          token: string
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          email?: string
          invited_by?: string
          accepted?: boolean
          accepted_at?: string | null
          token?: string
          expires_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      // Gift-giving events. Two shapes share this table (see
      // 20260910100000_occasions_schema.sql): birthday/anniversary rows key on
      // celebrant_id with group_id null, and group_date rows key on group_id
      // (with name required) and celebrant_id null. Phase 1 only ever wrote
      // group_date rows here, by hand -- birthdays/anniversaries derived at
      // read time via get_upcoming_occasions() and, as of phase 2, also
      // materialize into this table via get_or_create_occasion() (see the
      // Functions block below) the first time an owner tags an item for one.
      // occasion_year is a generated column (extract(year from
      // occasion_date)), so it cannot be written directly.
      //
      // NAME COLLISION: tracked_gifts.occasion below is unrelated free text
      // in the private gift tracker -- not a foreign key, nothing to do with
      // this table.
      occasions: {
        Row: {
          id: string
          group_id: string | null
          kind: "birthday" | "anniversary" | "group_date"
          name: string | null
          occasion_date: string
          occasion_year: number
          celebrant_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id?: string | null
          kind: "birthday" | "anniversary" | "group_date"
          name?: string | null
          occasion_date: string
          occasion_year?: never
          celebrant_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string | null
          kind?: "birthday" | "anniversary" | "group_date"
          name?: string | null
          occasion_date?: string
          occasion_year?: never
          celebrant_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occasions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasions_celebrant_id_fkey"
            columns: ["celebrant_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      // The rate-limit ledger behind the link-preview fetcher. RLS is on with no
      // policies at all, so only the service-role client (lib/supabase/admin.ts)
      // can see or write these rows -- a user must not be able to read, and
      // above all must not be able to delete, the counter that bounds them.
      // Which is also why there is no FK on user_id; see Relationships below.
      link_fetch_log: {
        Row: {
          id: string
          user_id: string
          fetched_at: string
        }
        Insert: {
          id?: string
          user_id: string
          fetched_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          fetched_at?: string
        }
        // No relationships, deliberately. `user_id` is an opaque Clerk id and
        // NOT a foreign key: users may delete their own user_profiles row, so a
        // cascade from that DELETE would have let anyone reset their own rate
        // limit in one call (migration 20260826000000).
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          group_gift_id: string
          user_id: string
          content: string
          attachment_url: string | null
          is_edited: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_gift_id: string
          user_id: string
          content: string
          attachment_url?: string | null
          is_edited?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_gift_id?: string
          user_id?: string
          content?: string
          attachment_url?: string | null
          is_edited?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_group_gift_id_fkey"
            columns: ["group_gift_id"]
            isOneToOne: false
            referencedRelation: "group_gifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      profile_info: {
        Row: {
          id: string
          user_id: string
          category: "sizes" | "preferences" | "vehicles" | "personal" | "dates"
          field_name: string
          field_value: string | null
          privacy_settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          category: "sizes" | "preferences" | "vehicles" | "personal" | "dates"
          field_name: string
          field_value?: string | null
          privacy_settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          category?: "sizes" | "preferences" | "vehicles" | "personal" | "dates"
          field_name?: string
          field_value?: string | null
          privacy_settings?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_info_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      user_profiles: {
        Row: {
          id: string
          username: string
          display_name: string | null
          avatar_url: string | null
          bio: string | null
          email: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          email?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          email?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      wishlist_items: {
        Row: {
          id: string
          user_id: string
          title: string
          description: string | null
          url: string | null
          price: number | null
          image_url: string | null
          priority: "low" | "medium" | "high" | "must-have" | null
          category: string | null
          privacy_settings: Json
          claimed_by: string | null
          claimed_at: string | null
          purchased: boolean
          purchased_at: string | null
          out_of_stock_marked_by: string | null
          out_of_stock_marked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          description?: string | null
          url?: string | null
          price?: number | null
          image_url?: StoredImageValue | null
          priority?: "low" | "medium" | "high" | "must-have" | null
          category?: string | null
          privacy_settings?: Json
          claimed_by?: string | null
          claimed_at?: string | null
          purchased?: boolean
          purchased_at?: string | null
          out_of_stock_marked_by?: string | null
          out_of_stock_marked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          description?: string | null
          url?: string | null
          price?: number | null
          image_url?: StoredImageValue | null
          priority?: "low" | "medium" | "high" | "must-have" | null
          category?: string | null
          privacy_settings?: Json
          claimed_by?: string | null
          claimed_at?: string | null
          purchased?: boolean
          purchased_at?: string | null
          out_of_stock_marked_by?: string | null
          out_of_stock_marked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      // Owner-asserted link between a wishlist item and an occasion it is
      // meant for (20260911000002_wishlist_item_occasions.sql). PK is
      // (item_id, occasion_id) -- there is no surrogate `id` column. Both FKs
      // are ON DELETE CASCADE. created_at was made NOT NULL in
      // 20260911000003_tag_created_at_not_null.sql, after the table's own
      // migration first shipped it nullable.
      //
      // SELECT is gated by the ITEM's visibility (can_view_wishlist_item), not
      // the occasion's. INSERT and DELETE are gated by the item's OWNERSHIP.
      // There is no UPDATE policy at all, deliberately -- a tag has no mutable
      // field; changing which occasion an item is for is a delete plus an
      // insert.
      wishlist_item_occasions: {
        Row: {
          item_id: string
          occasion_id: string
          created_at: string
        }
        Insert: {
          item_id: string
          occasion_id: string
          created_at?: string
        }
        Update: {
          item_id?: string
          occasion_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_item_occasions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "wishlist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_item_occasions_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_field: {
        Args: {
          field_owner_id: string
          viewer_id: string
          privacy_settings: Json
        }
        Returns: boolean
      }
      can_view_wishlist_item: {
        Args: {
          item_owner_id: string
          viewer_id: string
          privacy_settings: Json
        }
        Returns: boolean
      }
      get_shared_groups: {
        Args: {
          user_a: string
          user_b: string
        }
        Returns: {
          group_id: string
          group_type: "family" | "friends" | "work" | "custom"
        }[]
      }
      get_upcoming_dates_for_notifications: {
        Args: {
          days_ahead?: number
          target_year?: number
        }
        Returns: {
          celebrant_id: string
          celebrant_username: string
          field_name: string
          field_value: string
          celebration_date: string
          group_id: string
          group_name: string
          group_type: "family" | "friends" | "work" | "custom"
          notified_user_id: string
          notified_user_email: string
        }[]
      }
      get_dates_today_for_user: {
        Args: {
          p_user_id: string
        }
        Returns: {
          celebrant_id: string
          celebrant_username: string
          celebrant_display_name: string | null
          field_name: string
          celebration_date: string
          group_id: string
          group_name: string
          group_type: string
          notification_id: string
          banner_dismissed: boolean
        }[]
      }
      // The invite-code resolver. SECURITY DEFINER, because a group has to be
      // readable by exactly one non-member -- the person holding its code --
      // and the groups SELECT policy is membership-only. Returns at most one
      // row, and deliberately does NOT echo the invite code back.
      find_group_by_invite_code: {
        Args: {
          p_invite_code: string
        }
        Returns: {
          id: string
          name: string
          description: string | null
          type: "family" | "friends" | "work" | "custom"
        }[]
      }
      // The only two ways to become a member of a group. group_members has no
      // INSERT policy (a self-grantable membership was a self-grantable key to
      // nearly everything the schema protects), so joining goes through these.
      // Both pin the new member to requesting_user_id() -- neither takes a
      // user parameter -- and both take a secret rather than an identity.
      //
      // Error codes, verified against the live database:
      //   28000 NOT AUTHENTICATED               -- called with no Clerk JWT
      //   22023 INVALID INVITE CODE             -- join_group_with_code
      //   23505 ALREADY A MEMBER                -- join_group_with_code
      //   22023 INVALID OR EXPIRED INVITATION   -- accept_group_invitation,
      //         raised identically for unknown, expired and already-accepted
      //         tokens; the caller must not be able to tell them apart
      //   23503 group_members_user_id_fkey      -- caller has no user_profiles
      //         row yet (see requireAuthWithProfile in the callers)
      join_group_with_code: {
        Args: {
          p_invite_code: string
        }
        Returns: string
      }
      accept_group_invitation: {
        Args: {
          p_token: string
        }
        Returns: string
      }
      // Every occasion the CALLER may see within p_days_ahead days. Takes NO
      // viewer parameter -- pins to requesting_user_id() internally, the same
      // defence join_group_with_code/accept_group_invitation use. See
      // supabase/migrations/20260910100002_occasions_derivation.sql. Missed
      // when that migration landed; added here so lib/actions/occasions.ts's
      // supabase.rpc() call type-checks against an actual declared function
      // instead of silently widening to `any`.
      get_upcoming_occasions: {
        Args: {
          p_days_ahead?: number
        }
        Returns: {
          occasion_id: string | null
          kind: "birthday" | "anniversary" | "group_date"
          name: string | null
          occasion_date: string
          celebrant_id: string | null
          celebrant_username: string | null
          celebrant_display_name: string | null
          group_id: string | null
          group_name: string | null
        }[]
      }
      // Materializes the CALLER'S OWN celebrated occasion and returns its id
      // (20260911000000_get_or_create_occasion.sql, superseded in place by
      // 20260911000001_get_or_create_occasion_returning.sql -- same signature,
      // an upsert-and-RETURN fix). Takes no subject parameter, deliberately:
      // the caller is always the celebrant. SECURITY DEFINER, pinned to
      // requesting_user_id() internally like join_group_with_code /
      // accept_group_invitation above.
      //
      // Error codes, verified against the migration:
      //   28000 NOT AUTHENTICATED   -- called with no Clerk JWT
      //   22023 INVALID p_kind / NO DATE ON FILE -- raised for p_kind =>
      //         'group_date' (group dates are created explicitly, never
      //         materialized) AND for a caller with no such date in
      //         profile_info; the caller cannot and must not need to tell
      //         these apart from the error code alone.
      get_or_create_occasion: {
        Args: {
          p_kind: "birthday" | "anniversary" | "group_date"
        }
        Returns: string
      }
    }
    Enums: {
      group_type: "family" | "friends" | "work" | "custom"
      member_role: "owner" | "admin" | "member"
      privacy_level: "private" | "group" | "friends" | "family" | "public"
      gift_status: "planned" | "ordered" | "arrived" | "wrapped" | "given"
      occasion_kind: "birthday" | "anniversary" | "group_date"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
      PublicSchema["Views"])
  ? (PublicSchema["Tables"] &
      PublicSchema["Views"])[PublicTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
  ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
  ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
  ? PublicSchema["Enums"][PublicEnumNameOrOptions]
  : never
