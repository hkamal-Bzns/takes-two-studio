-- Add derivative metadata produced by the upload pipeline (src/lib/images.ts).
--
-- Every column is nullable with no default, so this is additive only: existing
-- rows keep their `url` / `coverImage` and simply carry NULL srcsets until the
-- master is re-uploaded. Readers must treat NULL srcsetAvif as "no derivatives,
-- use the plain url".
--
-- SQLite applies ALTER TABLE ADD COLUMN without rewriting the table, so this is
-- fast and does not lock the database for any meaningful time.
--
-- NOT YET APPLIED to any database. See the note in IMPLEMENTATION notes: this
-- project has no prior migration history (tables were created by raw DDL in
-- /api/setup and by `prisma db push`), so `prisma migrate deploy` will try to
-- run this against a database it considers unmigrated. Baseline first:
--   prisma migrate resolve --applied 20260727120000_add_image_derivatives
-- or apply the four ALTER statements by hand and then baseline.

ALTER TABLE "Project" ADD COLUMN "srcsetAvif" TEXT;
ALTER TABLE "Project" ADD COLUMN "srcsetWebp" TEXT;
ALTER TABLE "Project" ADD COLUMN "width" INTEGER;
ALTER TABLE "Project" ADD COLUMN "height" INTEGER;

ALTER TABLE "ProjectImage" ADD COLUMN "srcsetAvif" TEXT;
ALTER TABLE "ProjectImage" ADD COLUMN "srcsetWebp" TEXT;
ALTER TABLE "ProjectImage" ADD COLUMN "width" INTEGER;
ALTER TABLE "ProjectImage" ADD COLUMN "height" INTEGER;
