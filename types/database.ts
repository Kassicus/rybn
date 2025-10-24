export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      gift_group_members: {
        Row: {
          contribution_amount: number | null
          gift_group_id: string
          has_paid: boolean | null
          id: string
          joined_at: string | null
          user_id: string
        }
        Insert: {
          contribution_amount?: number | null
          gift_group_id: string
          has_paid?: boolean | null
          id?: string
          joined_at?: string | null
          user_id: string
        }
        Update: {
          contribution_amount?: number | null
          gift_group_id?: string
          has_paid?: boolean | null
          id?: string
          joined_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_group_members_gift_group_id_fkey"
            columns: ["gift_group_id"]
            isOneToOne: false
            referencedRelation: "gift_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_groups: {
        Row: {
          created_at: string | null
          created_by: string
          current_amount: number | null
          description: string | null
          group_id: string
          id: string
          is_active: boolean | null
          name: string
          target_amount: number | null
          target_user_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          current_amount?: number | null
          description?: string | null
          group_id: string
          id?: string
          is_active?: boolean | null
          name: string
          target_amount?: number | null
          target_user_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          current_amount?: number | null
          description?: string | null
          group_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          target_amount?: number | null
          target_user_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string | null
          id: string
          joined_at: string | null
          role: Database["public"]["Enums"]["member_role"] | null
          user_id: string | null
        }
        Insert: {
          group_id?: string | null
          id?: string
          joined_at?: string | null
          role?: Database["public"]["Enums"]["member_role"] | null
          user_id?: string | null
        }
        Update: {
          group_id?: string | null
          id?: string
          joined_at?: string | null
          role?: Database["public"]["Enums"]["member_role"] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          invite_code: string
          name: string
          settings: Json | null
          type: Database["public"]["Enums"]["group_type"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          invite_code: string
          name: string
          settings?: Json | null
          type?: Database["public"]["Enums"]["group_type"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          invite_code?: string
          name?: string
          settings?: Json | null
          type?: Database["public"]["Enums"]["group_type"]
          updated_at?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted: boolean | null
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string
          group_id: string | null
          id: string
          invited_by: string
          token: string
        }
        Insert: {
          accepted?: boolean | null
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at: string
          group_id?: string | null
          id?: string
          invited_by: string
          token: string
        }
        Update: {
          accepted?: boolean | null
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          group_id?: string | null
          id?: string
          invited_by?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_url: string | null
          content: string
          created_at: string | null
          gift_group_id: string
          id: string
          is_edited: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          attachment_url?: string | null
          content: string
          created_at?: string | null
          gift_group_id: string
          id?: string
          is_edited?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          attachment_url?: string | null
          content?: string
          created_at?: string | null
          gift_group_id?: string
          id?: string
          is_edited?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_gift_group_id_fkey"
            columns: ["gift_group_id"]
            isOneToOne: false
            referencedRelation: "gift_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_info: {
        Row: {
          category: string
          created_at: string | null
          field_name: string
          field_value: string | null
          id: string
          privacy_settings: Json
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          field_name: string
          field_value?: string | null
          id?: string
          privacy_settings?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          field_name?: string
          field_value?: string | null
          id?: string
          privacy_settings?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          id: string
          updated_at: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id: string
          updated_at?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          category: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          price: number | null
          priority: string | null
          privacy_settings: Json
          purchased: boolean | null
          purchased_at: string | null
          title: string
          updated_at: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          priority?: string | null
          privacy_settings?: Json
          purchased?: boolean | null
          purchased_at?: string | null
          title: string
          updated_at?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          priority?: string | null
          privacy_settings?: Json
          purchased?: boolean | null
          purchased_at?: string | null
          title?: string
          updated_at?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_field: {
        Args: {
          field_owner_id: string
          privacy_settings: Json
          viewer_id: string
        }
        Returns: boolean
      }
      can_view_wishlist_item: {
        Args: {
          item_owner_id: string
          privacy_settings: Json
          viewer_id: string
        }
        Returns: boolean
      }
      get_shared_groups: {
        Args: { user_a: string; user_b: string }
        Returns: {
          group_id: string
          group_type: Database["public"]["Enums"]["group_type"]
        }[]
      }
      is_group_member: {
        Args: { check_group_id: string; check_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      group_type: "family" | "friends" | "work" | "custom"
      member_role: "owner" | "admin" | "member"
      privacy_level: "private" | "group" | "friends" | "family" | "public"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      group_type: ["family", "friends", "work", "custom"],
      member_role: ["owner", "admin", "member"],
      privacy_level: ["private", "group", "friends", "family", "public"],
    },
  },
} as const

