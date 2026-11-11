ALTER TABLE "recognition_movements" ALTER COLUMN "entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_entry" CHECK ("recognition_movements"."entry_id" is not null
        or ("recognition_movements"."kind" = 'reclassified' and "recognition_movements"."transaction_minor" = 0 and "recognition_movements"."book_minor" = 0
          and coalesce("recognition_movements"."parallel_minor", 0) = 0));