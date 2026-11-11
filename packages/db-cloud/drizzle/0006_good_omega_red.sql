CREATE TABLE "app_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"origin_branch_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"company_id" text NOT NULL,
	"version_code" integer NOT NULL,
	"version_name" text NOT NULL,
	"notas" text,
	"url" text NOT NULL,
	"publicada" boolean DEFAULT false NOT NULL,
	"publicado_en" timestamp with time zone,
	"publicado_por" text
);
--> statement-breakpoint
ALTER TABLE "app_releases" ADD CONSTRAINT "app_releases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_releases_company_version_uq" ON "app_releases" USING btree ("company_id","version_code");--> statement-breakpoint
CREATE INDEX "app_releases_company_idx" ON "app_releases" USING btree ("company_id");