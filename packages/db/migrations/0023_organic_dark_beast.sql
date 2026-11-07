ALTER TABLE "entry_draft_lines" ADD COLUMN "open_item_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD COLUMN "new_item_reference" text;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD COLUMN "new_item_due_on" date;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_open_item_fk" FOREIGN KEY ("company_id","open_item_id") REFERENCES "public"."open_items"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_draft_lines_company_open_item_idx" ON "entry_draft_lines" USING btree ("company_id","open_item_id");--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_item" CHECK (("entry_draft_lines"."open_item_id" is null or "entry_draft_lines"."new_item_reference" is null)
        and ("entry_draft_lines"."new_item_due_on" is null or "entry_draft_lines"."new_item_reference" is not null));--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_new_item_reference_length" CHECK ("entry_draft_lines"."new_item_reference" is null or char_length("entry_draft_lines"."new_item_reference") between 1 and 100);