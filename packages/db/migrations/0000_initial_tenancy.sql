CREATE TYPE "public"."mailbox_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_auth_organization_id_unique" UNIQUE("auth_organization_id"),
	CONSTRAINT "organisation_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organisation_oauth_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_oauth_client_org_provider_key" UNIQUE("organisation_id","provider")
);
--> statement-breakpoint
ALTER TABLE "organisation_oauth_client" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organisation_oauth_client" ADD CONSTRAINT "organisation_oauth_client_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organisation_oauth_client_org_idx" ON "organisation_oauth_client" USING btree ("organisation_id","provider");--> statement-breakpoint
CREATE POLICY "organisation_oauth_client_tenant_isolation" ON "organisation_oauth_client" AS PERMISSIVE FOR ALL TO "app_user" USING (organisation_id = current_setting('app.organisation_id', true)::uuid) WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);