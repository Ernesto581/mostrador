DROP INDEX "users_company_username_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "users_company_username_uq" ON "users" USING btree ("company_id","username") WHERE deleted_at is null;