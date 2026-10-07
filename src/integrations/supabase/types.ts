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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      arb_execution_audit: {
        Row: {
          action: string
          capital: number
          confidence: number
          created_at: string
          detail: Json
          id: string
          label: string | null
          legs: number
          mode: string
          profit: number
          reason: string | null
          session_id: string
          source: string
          user_id: string | null
        }
        Insert: {
          action: string
          capital?: number
          confidence?: number
          created_at?: string
          detail?: Json
          id?: string
          label?: string | null
          legs?: number
          mode?: string
          profit?: number
          reason?: string | null
          session_id?: string
          source: string
          user_id?: string | null
        }
        Update: {
          action?: string
          capital?: number
          confidence?: number
          created_at?: string
          detail?: Json
          id?: string
          label?: string | null
          legs?: number
          mode?: string
          profit?: number
          reason?: string | null
          session_id?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      metrics_snapshots: {
        Row: {
          active_positions: number
          anomaly_score: number
          captured_at: string
          daily_pnl: number
          extra: Json
          id: string
          markets_monitored: number
          max_drawdown: number
          session_id: string
          sharpe_ratio: number
          total_pnl: number
          trades_executed: number
          user_id: string | null
          win_rate: number
        }
        Insert: {
          active_positions?: number
          anomaly_score?: number
          captured_at?: string
          daily_pnl?: number
          extra?: Json
          id?: string
          markets_monitored?: number
          max_drawdown?: number
          session_id: string
          sharpe_ratio?: number
          total_pnl?: number
          trades_executed?: number
          user_id?: string | null
          win_rate?: number
        }
        Update: {
          active_positions?: number
          anomaly_score?: number
          captured_at?: string
          daily_pnl?: number
          extra?: Json
          id?: string
          markets_monitored?: number
          max_drawdown?: number
          session_id?: string
          sharpe_ratio?: number
          total_pnl?: number
          trades_executed?: number
          user_id?: string | null
          win_rate?: number
        }
        Relationships: []
      }
      order_audit_log: {
        Row: {
          created_at: string
          error_message: string | null
          http_status: number | null
          id: string
          market_label: string | null
          mode: string
          order_id: string | null
          order_type: string
          polymarket_response: Json
          price: number
          retry_of: string | null
          side: string
          size: number
          status: string
          token_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          market_label?: string | null
          mode?: string
          order_id?: string | null
          order_type?: string
          polymarket_response?: Json
          price: number
          retry_of?: string | null
          side: string
          size: number
          status?: string
          token_id?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          market_label?: string | null
          mode?: string
          order_id?: string | null
          order_type?: string
          polymarket_response?: Json
          price?: number
          retry_of?: string | null
          side?: string
          size?: number
          status?: string
          token_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      psychology_snapshots: {
        Row: {
          created_at: string
          id: string
          is_healthy: boolean
          strategy_name: string
          trades: number
          user_id: string | null
          win_rate: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_healthy: boolean
          strategy_name: string
          trades: number
          user_id?: string | null
          win_rate: number
        }
        Update: {
          created_at?: string
          id?: string
          is_healthy?: boolean
          strategy_name?: string
          trades?: number
          user_id?: string | null
          win_rate?: number
        }
        Relationships: []
      }
      rans_diagnostic_events: {
        Row: {
          created_at: string
          detail: Json
          event_type: string
          id: string
          search_blob: string | null
          search_tsv: unknown
          severity: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          search_blob?: string | null
          search_tsv?: unknown
          severity?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          search_blob?: string | null
          search_tsv?: unknown
          severity?: string
          user_id?: string | null
        }
        Relationships: []
      }
      trade_settings_audit: {
        Row: {
          actor: string
          changes: Json
          created_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          actor?: string
          changes: Json
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          actor?: string
          changes?: Json
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
