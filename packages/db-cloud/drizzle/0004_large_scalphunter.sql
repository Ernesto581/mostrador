CREATE TABLE "sync_operations" (
	"op_id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"tipo" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
