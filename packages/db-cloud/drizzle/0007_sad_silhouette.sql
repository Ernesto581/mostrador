CREATE TABLE "inventory_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"product_id" text NOT NULL,
	"supplier_id" text,
	"document_type" text,
	"document_id" text,
	"document_folio" text,
	"unit_cost" integer NOT NULL,
	"initial_quantity" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"expiration_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_lot_balances" (
	"lot_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lot_balances_lot_id_branch_id_warehouse_id_pk" PRIMARY KEY("lot_id","branch_id","warehouse_id"),
	CONSTRAINT "stock_lot_balances_no_negativo" CHECK ("stock_lot_balances"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_line_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_line_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "lot_id" text;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_lots" ADD CONSTRAINT "sale_line_lots_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_lots" ADD CONSTRAINT "sale_line_lots_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_lots_product_received_idx" ON "inventory_lots" USING btree ("product_id","received_at");--> statement-breakpoint
CREATE INDEX "inventory_lots_document_idx" ON "inventory_lots" USING btree ("document_type","document_id");--> statement-breakpoint
CREATE INDEX "stock_lot_balances_branch_product_idx" ON "stock_lot_balances" USING btree ("branch_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "sale_line_lots_line_idx" ON "sale_line_lots" USING btree ("sale_line_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;