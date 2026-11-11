ALTER TABLE "recognition_movements" ADD COLUMN "credit_minor" bigint;--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_credit" CHECK (("recognition_movements"."kind" = 'credited') = ("recognition_movements"."credit_minor" is not null)
        and ("recognition_movements"."credit_minor" is null or "recognition_movements"."credit_minor" <> 0));