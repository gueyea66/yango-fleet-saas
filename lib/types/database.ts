export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: "admin" | "driver";
          phone_number?: string;
          avatar_url?: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role: "admin" | "driver";
          phone_number?: string;
          avatar_url?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: "admin" | "driver";
          phone_number?: string;
          avatar_url?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      vehicles: {
        Row: {
          id: string;
          driver_id: string;
          registration_number: string;
          brand: string;
          model: string;
          color: string;
          year: number;
          transmission: string;
          fuel_type: string;
          status: "active" | "inactive" | "maintenance";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          registration_number: string;
          brand: string;
          model: string;
          color: string;
          year: number;
          transmission: string;
          fuel_type: string;
          status?: "active" | "inactive" | "maintenance";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          driver_id?: string;
          registration_number?: string;
          brand?: string;
          model?: string;
          color?: string;
          year?: number;
          transmission?: string;
          fuel_type?: string;
          status?: "active" | "inactive" | "maintenance";
          updated_at?: string;
        };
      };
      daily_reports: {
        Row: {
          id: string;
          driver_id: string;
          vehicle_id: string;
          date: string;
          start_odometer: number;
          end_odometer: number;
          gross_earnings: number;
          commission_rate: number;
          commission_amount: number;
          net_after_expenses: number;
          expense_count: number;
          status: "draft" | "submitted" | "approved" | "rejected";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          vehicle_id: string;
          date: string;
          start_odometer: number;
          end_odometer: number;
          gross_earnings: number;
          commission_rate?: number;
          commission_amount?: number;
          net_after_expenses?: number;
          expense_count?: number;
          status?: "draft" | "submitted" | "approved" | "rejected";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "draft" | "submitted" | "approved" | "rejected";
          updated_at?: string;
        };
      };
      expenses: {
        Row: {
          id: string;
          report_id: string;
          driver_id: string;
          category: string;
          amount: number;
          description: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          driver_id: string;
          category: string;
          amount: number;
          description: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          amount?: number;
          description?: string;
          updated_at?: string;
        };
      };
      uploads: {
        Row: {
          id: string;
          user_id: string;
          file_name: string;
          file_url: string;
          file_size: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          file_name: string;
          file_url: string;
          file_size: number;
          created_at?: string;
        };
      };
      settings: {
        Row: {
          id: string;
          key: string;
          value: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          value: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          value?: string;
          updated_at?: string;
        };
      };
      salary_rules: {
        Row: {
          id: string;
          min_monthly_earnings: number;
          max_monthly_earnings: number;
          salary_percentage: number;
          bonus?: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          min_monthly_earnings: number;
          max_monthly_earnings: number;
          salary_percentage: number;
          bonus?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          min_monthly_earnings?: number;
          max_monthly_earnings?: number;
          salary_percentage?: number;
          bonus?: number;
          updated_at?: string;
        };
      };
    };
  };
};
