-- Add derivative metadata produced by the upload pipeline (src/lib/images.ts).
--
-- Every column is nullable with no default, so this is additive only: existing
-- rows keep their `url` / `coverImage` and simply carry NULL srcsets until the
-- master is re-uploaded. Readers must treat NULL srcsetAvif as "no derivatives,
-- use the plain url".
--
-- There are EIGHT statements below: four columns on Project and four on
-- ProjectImage. Applying only one set leaves every Prisma query failing on the
-- other table, so run all eight or none.
--
-- ADD COLUMN with no DEFAULT is metadata-only in SQLite — it rewrites the
-- schema, not the rows. Existing data is not read, copied or modified, and the
-- operation is O(1) regardless of table size. Rows that predate the change read
-- back as NULL for the new columns.
--
-- NOT APPLIED to the production database. It has been applied once, during
-- testing, to a throwaway copy of db/custom.db outside the repo.
--
-- This project has no prior migration history: the tables were created by raw
-- DDL in /api/setup and by `prisma db push`, so there is no _prisma_migrations
-- table. Two correct ways to land it, in this order:
--
--   A. npx prisma migrate deploy
--      Creates _prisma_migrations, runs the eight statements, and records the
--      migration in one step. Never resets or drops anything.
--
--   B. Run the eight statements by hand, THEN record them:
--      npx prisma migrate resolve --applied 20260727120000_add_image_derivatives
--
-- Do NOT run `migrate resolve --applied` before the columns exist. It marks the
-- migration as done WITHOUT executing any SQL, so the database would be left
-- without the columns while Prisma believes the work is finished — every query
-- against Project and ProjectImage then fails with "column does not exist", and
-- the public site renders empty.

ALTER TABLE "Project" ADD COLUMN "srcsetAvif" TEXT;
ALTER TABLE "Project" ADD COLUMN "srcsetWebp" TEXT;
ALTER TABLE "Project" ADD COLUMN "width" INTEGER;
ALTER TABLE "Project" ADD COLUMN "height" INTEGER;

ALTER TABLE "ProjectImage" ADD COLUMN "srcsetAvif" TEXT;
ALTER TABLE "ProjectImage" ADD COLUMN "srcsetWebp" TEXT;
ALTER TABLE "ProjectImage" ADD COLUMN "width" INTEGER;
ALTER TABLE "ProjectImage" ADD COLUMN "height" INTEGER;
