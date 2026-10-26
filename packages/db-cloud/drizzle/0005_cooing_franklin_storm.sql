ALTER TABLE "branches" ADD COLUMN "descripcion" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "tipo_negocio" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "foto_url" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "provincia" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "municipio" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "horarios" jsonb;