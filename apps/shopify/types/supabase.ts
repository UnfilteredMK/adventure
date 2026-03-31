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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      account_credit_transactions: {
        Row: {
          account_id: string
          created_at: string
          credit_amount: number
          description: string | null
          id: string
          instance_id: string | null
          metadata: Json | null
          reload_attempt_description:
            | Database["public"]["Enums"]["credit_reload_attempt_description"]
            | null
          reload_attempt_status:
            | Database["public"]["Enums"]["credit_reload_attempt_status"]
            | null
          reload_type: Database["public"]["Enums"]["credit_reload_type"] | null
          type: Database["public"]["Enums"]["credit_transaction_type"]
        }
        Insert: {
          account_id: string
          created_at?: string
          credit_amount: number
          description?: string | null
          id?: string
          instance_id?: string | null
          metadata?: Json | null
          reload_attempt_description?:
            | Database["public"]["Enums"]["credit_reload_attempt_description"]
            | null
          reload_attempt_status?:
            | Database["public"]["Enums"]["credit_reload_attempt_status"]
            | null
          reload_type?: Database["public"]["Enums"]["credit_reload_type"] | null
          type: Database["public"]["Enums"]["credit_transaction_type"]
        }
        Update: {
          account_id?: string
          created_at?: string
          credit_amount?: number
          description?: string | null
          id?: string
          instance_id?: string | null
          metadata?: Json | null
          reload_attempt_description?:
            | Database["public"]["Enums"]["credit_reload_attempt_description"]
            | null
          reload_attempt_status?:
            | Database["public"]["Enums"]["credit_reload_attempt_status"]
            | null
          reload_type?: Database["public"]["Enums"]["credit_reload_type"] | null
          type?: Database["public"]["Enums"]["credit_transaction_type"]
        }
        Relationships: []
      }
      accounts: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      accounts_shopify: {
        Row: {
          account_id: string
          created_at: string | null
          is_active: boolean | null
          selected_instance_id: string | null
          enable_product_button: boolean
          enable_product_image: boolean
          btn_text: string | null
          btn_bg: string | null
          btn_color: string | null
          btn_radius: number | null
          overlay_text: string | null
          overlay_bg: string | null
          overlay_color: string | null
          shopify_store_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          is_active?: boolean | null
          selected_instance_id?: string | null
          enable_product_button?: boolean
          enable_product_image?: boolean
          btn_text?: string | null
          btn_bg?: string | null
          btn_color?: string | null
          btn_radius?: number | null
          overlay_text?: string | null
          overlay_bg?: string | null
          overlay_color?: string | null
          shopify_store_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          is_active?: boolean | null
          selected_instance_id?: string | null
          enable_product_button?: boolean
          enable_product_image?: boolean
          btn_text?: string | null
          btn_bg?: string | null
          btn_color?: string | null
          btn_radius?: number | null
          overlay_text?: string | null
          overlay_bg?: string | null
          overlay_color?: string | null
          shopify_store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_shopify_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_shopify_selected_instance_fkey",
            columns: ["selected_instance_id"],
            isOneToOne: false,
            referencedRelation: "instances",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "accounts_shopify_shopify_store_id_fkey"
            columns: ["shopify_store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          account_id: string | null
          created_at: string
          default_og_image_url: string | null
          default_seo_description: string | null
          default_seo_title: string | null
          description: string | null
          id: string
          instance_type: string | null
          name: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          default_og_image_url?: string | null
          default_seo_description?: string | null
          default_seo_title?: string | null
          description?: string | null
          id?: string
          instance_type?: string | null
          name: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          default_og_image_url?: string | null
          default_seo_description?: string | null
          default_seo_title?: string | null
          description?: string | null
          id?: string
          instance_type?: string | null
          name?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      categories_subcategories: {
        Row: {
          account_id: string | null
          canonical_path: string | null
          category_id: string
          content: string | null
          created_at: string
          credit_price: number
          demo_template_config: Json | null
          demo_theme_key: string | null
          description: string | null
          email_lead_price: number
          faq: Json | null
          h1: string | null
          hero_cta_text: string | null
          hero_cta_url: string | null
          hero_tagline: string | null
          id: string
          instance_type: string | null
          last_reviewed_at: string | null
          noindex: boolean | null
          og_description: string | null
          og_image_url: string | null
          og_title: string | null
          phone_lead_price: number
          priority: number | null
          sample_images: Json | null
          schema_props: Json | null
          schema_type: string | null
          seo_description: string | null
          seo_keywords: string[] | null
          seo_title: string | null
          slug: string | null
          status: string
          subcategory: string
          twitter_image_url: string | null
          updated_at: string
          use_cases: Json | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          canonical_path?: string | null
          category_id: string
          content?: string | null
          created_at?: string
          credit_price?: number
          demo_template_config?: Json | null
          demo_theme_key?: string | null
          description?: string | null
          email_lead_price?: number
          faq?: Json | null
          h1?: string | null
          hero_cta_text?: string | null
          hero_cta_url?: string | null
          hero_tagline?: string | null
          id?: string
          instance_type?: string | null
          last_reviewed_at?: string | null
          noindex?: boolean | null
          og_description?: string | null
          og_image_url?: string | null
          og_title?: string | null
          phone_lead_price?: number
          priority?: number | null
          sample_images?: Json | null
          schema_props?: Json | null
          schema_type?: string | null
          seo_description?: string | null
          seo_keywords?: string[] | null
          seo_title?: string | null
          slug?: string | null
          status?: string
          subcategory: string
          twitter_image_url?: string | null
          updated_at?: string
          use_cases?: Json | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          canonical_path?: string | null
          category_id?: string
          content?: string | null
          created_at?: string
          credit_price?: number
          demo_template_config?: Json | null
          demo_theme_key?: string | null
          description?: string | null
          email_lead_price?: number
          faq?: Json | null
          h1?: string | null
          hero_cta_text?: string | null
          hero_cta_url?: string | null
          hero_tagline?: string | null
          id?: string
          instance_type?: string | null
          last_reviewed_at?: string | null
          noindex?: boolean | null
          og_description?: string | null
          og_image_url?: string | null
          og_title?: string | null
          phone_lead_price?: number
          priority?: number | null
          sample_images?: Json | null
          schema_props?: Json | null
          schema_type?: string | null
          seo_description?: string | null
          seo_keywords?: string[] | null
          seo_title?: string | null
          slug?: string | null
          status?: string
          subcategory?: string
          twitter_image_url?: string | null
          updated_at?: string
          use_cases?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_subcategories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          account_id: string | null
          created_at: string | null
          email: string
          id: string
          instance_id: string
          ip_address: unknown
          is_partial: boolean | null
          name: string | null
          phone: string | null
          referrer: string | null
          session_id: string | null
          submission_data: Json | null
          updated_at: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          instance_id: string
          ip_address?: unknown
          is_partial?: boolean | null
          name?: string | null
          phone?: string | null
          referrer?: string | null
          session_id?: string | null
          submission_data?: Json | null
          updated_at?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          instance_id?: string
          ip_address?: unknown
          is_partial?: boolean | null
          name?: string | null
          phone?: string | null
          referrer?: string | null
          session_id?: string | null
          submission_data?: Json | null
          updated_at?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          account_id: string | null
          created_at: string | null
          id: string
          image_url: string
          instance_id: string | null
          metadata: Json | null
          model_id: string | null
          negative_prompt: string | null
          prompt_id: string | null
          replicate_prediction_id: string | null
          status: string | null
          subcategory_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          id?: string
          image_url: string
          instance_id?: string | null
          metadata?: Json | null
          model_id?: string | null
          negative_prompt?: string | null
          prompt_id?: string | null
          replicate_prediction_id?: string | null
          status?: string | null
          subcategory_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string
          instance_id?: string | null
          metadata?: Json | null
          model_id?: string | null
          negative_prompt?: string | null
          prompt_id?: string | null
          replicate_prediction_id?: string | null
          status?: string | null
          subcategory_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "images_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "categories_subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      instance_sample_gallery: {
        Row: {
          created_at: string | null
          id: string
          image_id: string
          instance_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_id: string
          instance_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_id?: string
          instance_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instance_sample_gallery_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instance_sample_gallery_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      instance_subcategories: {
        Row: {
          account_id: string | null
          category_subcategory_id: string
          created_at: string
          instance_id: string
        }
        Insert: {
          account_id?: string | null
          category_subcategory_id: string
          created_at?: string
          instance_id: string
        }
        Update: {
          account_id?: string | null
          category_subcategory_id?: string
          created_at?: string
          instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instance_subcategories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instance_subcategories_category_subcategory_id_fkey"
            columns: ["category_subcategory_id"]
            isOneToOne: false
            referencedRelation: "categories_subcategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instance_subcategories_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      instances: {
        Row: {
          account_id: string | null
          config: Json | null
          created_at: string | null
          credit_price: number
          demo_instance: boolean
          demo_instance_type:
            | Database["public"]["Enums"]["demo_instance_type_enum"]
            | null
          description: string | null
          email_lead_price: number
          id: string
          instance_type: string | null
          is_public: boolean | null
          max_submissions_per_session: number
          name: string
          phone_lead_price: number
          slug: string
          submission_limit_enabled: boolean
          updated_at: string | null
          user_id: string | null
          webhook_url: string | null
        }
        Insert: {
          account_id?: string | null
          config?: Json | null
          created_at?: string | null
          credit_price?: number
          demo_instance?: boolean
          demo_instance_type?:
            | Database["public"]["Enums"]["demo_instance_type_enum"]
            | null
          description?: string | null
          email_lead_price?: number
          id?: string
          instance_type?: string | null
          is_public?: boolean | null
          max_submissions_per_session?: number
          name: string
          phone_lead_price?: number
          slug: string
          submission_limit_enabled?: boolean
          updated_at?: string | null
          user_id?: string | null
          webhook_url?: string | null
        }
        Update: {
          account_id?: string | null
          config?: Json | null
          created_at?: string | null
          credit_price?: number
          demo_instance?: boolean
          demo_instance_type?:
            | Database["public"]["Enums"]["demo_instance_type_enum"]
            | null
          description?: string | null
          email_lead_price?: number
          id?: string
          instance_type?: string | null
          is_public?: boolean | null
          max_submissions_per_session?: number
          name?: string
          phone_lead_price?: number
          slug?: string
          submission_limit_enabled?: boolean
          updated_at?: string | null
          user_id?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          additional_credit_price: number | null
          ai_credits_included: number
          analytics_level: string | null
          api_access: boolean | null
          created_at: string | null
          exclusivity: boolean | null
          is_pricing_custom: boolean | null
          lead_capture_level: string | null
          max_widgets: number | null
          monthly_price_cents: number | null
          name: string
          onboarding_type: string | null
          plan_id: string
          prompt_packs_level: string | null
          revenue_share: boolean | null
          setup_fee_cents: number | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          support_level: string | null
          updated_at: string | null
          white_label: boolean | null
        }
        Insert: {
          additional_credit_price?: number | null
          ai_credits_included?: number
          analytics_level?: string | null
          api_access?: boolean | null
          created_at?: string | null
          exclusivity?: boolean | null
          is_pricing_custom?: boolean | null
          lead_capture_level?: string | null
          max_widgets?: number | null
          monthly_price_cents?: number | null
          name: string
          onboarding_type?: string | null
          plan_id?: string
          prompt_packs_level?: string | null
          revenue_share?: boolean | null
          setup_fee_cents?: number | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          support_level?: string | null
          updated_at?: string | null
          white_label?: boolean | null
        }
        Update: {
          additional_credit_price?: number | null
          ai_credits_included?: number
          analytics_level?: string | null
          api_access?: boolean | null
          created_at?: string | null
          exclusivity?: boolean | null
          is_pricing_custom?: boolean | null
          lead_capture_level?: string | null
          max_widgets?: number | null
          monthly_price_cents?: number | null
          name?: string
          onboarding_type?: string | null
          plan_id?: string
          prompt_packs_level?: string | null
          revenue_share?: boolean | null
          setup_fee_cents?: number | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          support_level?: string | null
          updated_at?: string | null
          white_label?: boolean | null
        }
        Relationships: []
      }
      prompts: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          prompt: string
          updated_at: string
          variables: Json | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          prompt: string
          updated_at?: string
          variables?: Json | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          prompt?: string
          updated_at?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "prompts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          category_id: string | null
          company_name: string
          company_type: Database["public"]["Enums"]["company_type_enum"]
          company_website: string | null
          created_at: string
          demo_theme_key: string | null
          id: string
          is_public: boolean
          logo_url: string | null
          revenue_annual: number | null
          services: string[] | null
          slug: string
          subcategory_id: string | null
          updated_at: string
          website_traffic: number | null
        }
        Insert: {
          category_id?: string | null
          company_name: string
          company_type?: Database["public"]["Enums"]["company_type_enum"]
          company_website?: string | null
          created_at?: string
          demo_theme_key?: string | null
          id?: string
          is_public?: boolean
          logo_url?: string | null
          revenue_annual?: number | null
          services?: string[] | null
          slug: string
          subcategory_id?: string | null
          updated_at?: string
          website_traffic?: number | null
        }
        Update: {
          category_id?: string | null
          company_name?: string
          company_type?: Database["public"]["Enums"]["company_type_enum"]
          company_website?: string | null
          created_at?: string
          demo_theme_key?: string | null
          id?: string
          is_public?: boolean
          logo_url?: string | null
          revenue_annual?: number | null
          services?: string[] | null
          slug?: string
          subcategory_id?: string | null
          updated_at?: string
          website_traffic?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prospects_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "categories_subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_stores: {
        Row: {
          access_token: string
          created_at: string | null
          id: string
          installed_at: string | null
          shop_id: string
          shop_name: string | null
          shop_owner_email: string | null
          store_domain: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          id?: string
          installed_at?: string | null
          shop_id: string
          shop_name?: string | null
          shop_owner_email?: string | null
          store_domain: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          id?: string
          installed_at?: string | null
          shop_id?: string
          shop_name?: string | null
          shop_owner_email?: string | null
          store_domain?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_accounts: {
        Row: {
          account_id: string
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
          user_status: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          user_status?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          user_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          account_id: string | null
          additional_credit_price: number | null
          ai_credits_balance: number
          auto_purchase_amount: number | null
          auto_purchase_enabled: boolean | null
          created_at: string | null
          end_date: string | null
          monthly_price_cents: number
          partner_approval: Database["public"]["Enums"]["partner_approval_status"]
          plan_id: string | null
          start_date: string
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_id: string
          trial_end: string | null
          updated_at: string | null
          user_id: string | null
          user_type: string
        }
        Insert: {
          account_id?: string | null
          additional_credit_price?: number | null
          ai_credits_balance?: number
          auto_purchase_amount?: number | null
          auto_purchase_enabled?: boolean | null
          created_at?: string | null
          end_date?: string | null
          monthly_price_cents: number
          partner_approval?: Database["public"]["Enums"]["partner_approval_status"]
          plan_id?: string | null
          start_date?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_id?: string
          trial_end?: string | null
          updated_at?: string | null
          user_id?: string | null
          user_type?: string
        }
        Update: {
          account_id?: string | null
          additional_credit_price?: number | null
          ai_credits_balance?: number
          auto_purchase_amount?: number | null
          auto_purchase_enabled?: boolean | null
          created_at?: string | null
          end_date?: string | null
          monthly_price_cents?: number
          partner_approval?: Database["public"]["Enums"]["partner_approval_status"]
          plan_id?: string | null
          start_date?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_id?: string
          trial_end?: string | null
          updated_at?: string | null
          user_id?: string | null
          user_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _build_hero_tagline: {
        Args: { p_keywords: string[]; p_sub: string }
        Returns: string
      }
      _build_hero_tagline_v2: {
        Args: { p_inst: string; p_keywords: string[]; p_sub: string }
        Returns: string
      }
      _gen_keywords: { Args: { base: string; inst: string }; Returns: string[] }
      _seed_content_for_subcategory: {
        Args: { p_id: string; p_keywords: string[]; p_sub: string }
        Returns: string
      }
      _select_relevant_keywords: {
        Args: { p_keywords: string[]; p_sub: string }
        Returns: string[]
      }
      _tokens_3: { Args: { p_text: string }; Returns: string[] }
      get_session_submission_count: {
        Args: { p_instance_id: string; p_session_id: string }
        Returns: number
      }
      has_email_submitted_for_instance: {
        Args: { p_email: string; p_instance_id: string }
        Returns: boolean
      }
      is_owner_for_account: { Args: { account: string }; Returns: boolean }
      is_user_in_account: { Args: { account_id: string }; Returns: boolean }
      slugify: { Args: { input: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      company_type_enum: "service" | "ecomm" | "both"
      credit_reload_attempt_description:
        | "insufficient_funds"
        | "card_expired"
        | "no_default_payment_method"
        | "authentication_required"
        | "other"
      credit_reload_attempt_status:
        | "succeeded"
        | "declined"
        | "failed"
        | "requires_action"
        | "pending"
        | "other"
      credit_reload_type: "manual" | "auto"
      credit_transaction_type:
        | "image_gen"
        | "email_lead"
        | "phone_lead"
        | "credit_reload"
      demo_instance_type_enum: "industry" | "prospect"
      partner_approval_status: "pending" | "approved"
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
      company_type_enum: ["service", "ecomm", "both"],
      credit_reload_attempt_description: [
        "insufficient_funds",
        "card_expired",
        "no_default_payment_method",
        "authentication_required",
        "other",
      ],
      credit_reload_attempt_status: [
        "succeeded",
        "declined",
        "failed",
        "requires_action",
        "pending",
        "other",
      ],
      credit_reload_type: ["manual", "auto"],
      credit_transaction_type: [
        "image_gen",
        "email_lead",
        "phone_lead",
        "credit_reload",
      ],
      demo_instance_type_enum: ["industry", "prospect"],
      partner_approval_status: ["pending", "approved"],
    },
  },
} as const
