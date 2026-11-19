-- Two lookups that read a whole table, now read only what they need.

-- An author page (/@handle) finds its author ignoring capitals, which the
-- plain unique index on handle can't answer. This one can, and it also keeps
-- two handles from differing only in capitals. (New handles are lowercase.)
CREATE UNIQUE INDEX authors_by_handle_nocase ON authors (handle COLLATE NOCASE);

-- Whether a picture is in a piece. The cleanup of pictures nobody used, and
-- the check on how much someone has waiting to publish, only ever look at
-- pictures that aren't: a handful, kept in their own small indexes.
ALTER TABLE images ADD COLUMN placed INTEGER NOT NULL DEFAULT 0;
UPDATE images SET placed = 1 WHERE hash IN (SELECT hash FROM post_images);
CREATE INDEX images_unplaced ON images (created_at) WHERE placed = 0;
CREATE INDEX images_waiting ON images (uploaded_by, created_at) WHERE placed = 0;
