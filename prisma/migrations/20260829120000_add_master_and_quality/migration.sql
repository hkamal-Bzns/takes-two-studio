-- Track the untouched original alongside each image, and let a single image opt
-- into being served at full original quality.
--
-- THREE statements, all on ProjectImage. Applying only some of them leaves every
-- Prisma query against the table failing on the missing column, so run all three
-- or none.
--
--   masterUrl    the original file as uploaded, or NULL when there is none.
--                528 of 576 existing bundles have no master on disk: they
--                arrived as pre-built derivatives and the original was never on
--                this server. That cannot be reconstructed from a derivative,
--                so NULL is a permanent, meaningful state and not a backlog to
--                be filled in automatically.
--   masterBytes  its size, so the admin can show what "Sharpest" would cost a
--                visitor before it is switched on.
--   useMaster    the Sharpest toggle. Defaults to false, so behaviour is
--                unchanged for every existing row and every new upload until
--                someone deliberately turns it on.
--
-- ADD COLUMN with no DEFAULT is metadata-only in SQLite: it rewrites the schema,
-- not the rows, and is O(1) regardless of table size. useMaster does carry a
-- DEFAULT, which SQLite also applies without rewriting rows. Existing data is
-- not read, copied or modified.
--
-- masterUrl/masterBytes are backfilled separately for the 48 images that do have
-- a master, by matching the derivative bundle's UUID against media/masters/.
-- That backfill is a script, not part of this migration, because it has to read
-- the filesystem.

ALTER TABLE "ProjectImage" ADD COLUMN "masterUrl" TEXT;
ALTER TABLE "ProjectImage" ADD COLUMN "masterBytes" INTEGER;
ALTER TABLE "ProjectImage" ADD COLUMN "useMaster" BOOLEAN NOT NULL DEFAULT false;
