CREATE TABLE "transfer_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"transfer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity_sent" integer NOT NULL,
	"quantity_received" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"origin_branch_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"company_id" text NOT NULL,
	"folio" text NOT NULL,
	"from_warehouse_id" text NOT NULL,
	"to_warehouse_id" text NOT NULL,
	"from_branch_id" text NOT NULL,
	"to_branch_id" text NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"reason" text,
	"has_discrepancy" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"dispatched_by_user_id" text,
	"dispatched_at" timestamp with time zone,
	"received_by_user_id" text,
	"received_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "currency" SET DEFAULT 'CUP';--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "currency" SET DEFAULT 'CUP';--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "venta_desde_almacen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "kind" text DEFAULT 'almacen' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dispatched_by_user_id_users_id_fk" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_lines_transfer_idx" ON "transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_company_folio_uq" ON "transfers" USING btree ("company_id","folio");--> statement-breakpoint
CREATE INDEX "transfers_from_branch_idx" ON "transfers" USING btree ("from_branch_id");--> statement-breakpoint
CREATE INDEX "transfers_to_branch_idx" ON "transfers" USING btree ("to_branch_id");--> statement-breakpoint
UPDATE "warehouses" SET "kind" = 'piso_venta' WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "type" = 'tienda');--> statement-breakpoint
INSERT INTO "warehouses" ("id", "branch_id", "code", "name", "kind", "active", "created_at", "updated_at", "revision")
SELECT gen_random_uuid()::text, b."id", 'ALM', 'Almacen', 'almacen', true, now(), now(), 1
FROM "branches" b
WHERE b."type" = 'tienda' AND NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."branch_id" = b."id" AND w."kind" = 'almacen');--> statement-breakpoint
UPDATE "companies" SET "currency" = 'CUP' WHERE "currency" = 'MXN';