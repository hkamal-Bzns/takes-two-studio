-- Focal point for anything the site crops, plus an optional portrait crop of a
-- cover for the hero on phones held upright.
--
-- focusX/focusY are NOT NULL with a default of 50, so every existing row keeps
-- exactly the centre crop it has today and nothing needs backfilling.
--
-- The portrait columns are all nullable: null means "no portrait crop", which
-- is every row until someone uploads one, and the reader falls back to the
-- landscape cover.

ALTER TABLE "Project" ADD COLUMN "focusX" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Project" ADD COLUMN "focusY" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Project" ADD COLUMN "portraitImage" TEXT;
ALTER TABLE "Project" ADD COLUMN "portraitSrcsetAvif" TEXT;
ALTER TABLE "Project" ADD COLUMN "portraitSrcsetWebp" TEXT;
ALTER TABLE "Project" ADD COLUMN "portraitWidth" INTEGER;
ALTER TABLE "Project" ADD COLUMN "portraitHeight" INTEGER;

ALTER TABLE "OverviewItem" ADD COLUMN "focusX" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "OverviewItem" ADD COLUMN "focusY" INTEGER NOT NULL DEFAULT 50;
