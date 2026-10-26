ALTER TABLE "invitations" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "created_by_user_id" DROP NOT NULL;