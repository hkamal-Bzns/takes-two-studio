-- Mark an image as belonging to a cover rather than to the gallery.
--
-- ONE statement. Covers uploaded straight into the cover field never had an
-- image record, so they had no original on file and no quality setting. Giving
-- them a record fixes that, but a cover is not automatically a picture the
-- studio chose to exhibit — so the record is flagged and kept out of the public
-- gallery, the lightbox and the Overview picker, while staying visible and
-- editable in the project editor.
--
-- Only set where a cover is a *different photograph* from everything in its
-- gallery. Where the cover is the same shot as a gallery image, the cover is
-- repointed at that image instead and nothing is created.
--
-- DEFAULT false, so every existing row and every new upload is unaffected until
-- something deliberately sets it. SQLite applies the default without rewriting
-- rows, so this is metadata-only and O(1).

ALTER TABLE "ProjectImage" ADD COLUMN "coverOnly" BOOLEAN NOT NULL DEFAULT false;
