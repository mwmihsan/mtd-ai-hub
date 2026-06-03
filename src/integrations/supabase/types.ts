export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      account_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          sub_account_name: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          sub_account_name: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          sub_account_name?: string
        }
        Relationships: []
      }
      account_rows: {
        Row: {
          account: string | null
          credit: number
          date: string | null
          debit: number
          description: string | null
          file_id: string
          id: string
          sub_account: string | null
        }
        Insert: {
          account?: string | null
          credit?: number
          date?: string | null
          debit?: number
          description?: string | null
          file_id: string
          id?: string
          sub_account?: string | null
        }
        Update: {
          account?: string | null
          credit?: number
          date?: string | null
          debit?: number
          description?: string | null
          file_id?: string
          id?: string
          sub_account?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_rows_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "uploaded_files"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachments: Json | null
          content: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          attachments?: Json | null
          content?: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          attachments?: Json | null
          content?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      corrections: {
        Row: {
          correct_result: string
          created_at: string
          id: string
          original_query: string
          usage_count: number
          wrong_result: string | null
        }
        Insert: {
          correct_result: string
          created_at?: string
          id?: string
          original_query: string
          usage_count?: number
          wrong_result?: string | null
        }
        Update: {
          correct_result?: string
          created_at?: string
          id?: string
          original_query?: string
          usage_count?: number
          wrong_result?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          chat_id: number
          created_at: string
          id: string
          query: string | null
          rating: string
          response_summary: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          id?: string
          query?: string | null
          rating: string
          response_summary?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          id?: string
          query?: string | null
          rating?: string
          response_summary?: string | null
        }
        Relationships: []
      }
      intent_training: {
        Row: {
          created_at: string
          description: string | null
          example_text: string
          id: string
          intent: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          example_text: string
          id?: string
          intent: string
        }
        Update: {
          created_at?: string
          description?: string | null
          example_text?: string
          id?: string
          intent?: string
        }
        Relationships: []
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_conversation_state: {
        Row: {
          chat_id: number
          context: Json
          expires_at: string
          pending: Json | null
          updated_at: string
        }
        Insert: {
          chat_id: number
          context?: Json
          expires_at?: string
          pending?: Json | null
          updated_at?: string
        }
        Update: {
          chat_id?: number
          context?: Json
          expires_at?: string
          pending?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      telegram_messages: {
        Row: {
          chat_id: number
          created_at: string
          raw_update: Json
          text: string | null
          update_id: number
        }
        Insert: {
          chat_id: number
          created_at?: string
          raw_update: Json
          text?: string | null
          update_id: number
        }
        Update: {
          chat_id?: number
          created_at?: string
          raw_update?: Json
          text?: string | null
          update_id?: number
        }
        Relationships: []
      }
      telegram_settings: {
        Row: {
          admin_chat_id: string | null
          bot_username: string | null
          id: number
          is_active: boolean
          stock_value: number
          updated_at: string
        }
        Insert: {
          admin_chat_id?: string | null
          bot_username?: string | null
          id: number
          is_active?: boolean
          stock_value?: number
          updated_at?: string
        }
        Update: {
          admin_chat_id?: string | null
          bot_username?: string | null
          id?: number
          is_active?: boolean
          stock_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      uploaded_files: {
        Row: {
          file_name: string
          id: string
          month: string
          row_count: number
          storage_path: string
          upload_date: string
        }
        Insert: {
          file_name: string
          id?: string
          month?: string
          row_count?: number
          storage_path: string
          upload_date?: string
        }
        Update: {
          file_name?: string
          id?: string
          month?: string
          row_count?: number
          storage_path?: string
          upload_date?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_first_admin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
