-- Record the colour space of a master.
--
-- Nullable: it is unknown for every master already on disk until something
-- reads them, and unknown must not be confused with "sRGB, verified". The
-- admin only warns on a value it has actually measured.

ALTER TABLE "ProjectImage" ADD COLUMN "masterSpace" TEXT;
