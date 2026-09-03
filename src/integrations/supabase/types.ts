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
          win_rate?: number
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
          win_rate: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_healthy: boolean
          strategy_name: string
          trades: number
          win_rate: number
        }
        Update: {
          created_at?: string
          id?: string
          is_healthy?: boolean
          strategy_name?: string
          trades?: number
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
        }
        Insert: {
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          search_blob?: string | null
          search_tsv?: unknown
          severity?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          search_blob?: string | null
          search_tsv?: unknown
          severity?: string
        }
        Relationships: []
      }
      trade_settings_audit: {
        Row: {
          actor: string
          changes: Json
          created_at: string
          id: string
        }
        Insert: {
          actor?: string
          changes: Json
          created_at?: string
          id?: string
        }
        Update: {
          actor?: string
          changes?: Json
          created_at?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
