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
          photo_url?: string | null
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
          photo_url?: string | null
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
          image_url?: string | null
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
          image_url?: string | null
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
    }
    Enums: {
      group_type: "family" | "friends" | "work" | "custom"
      member_role: "owner" | "admin" | "member"
      privacy_level: "private" | "group" | "friends" | "family" | "public"
      gift_status: "planned" | "ordered" | "arrived" | "wrapped" | "given"
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
