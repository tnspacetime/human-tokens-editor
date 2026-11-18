-- A series, published whole from Fold MD, is one piece: the series' title,
-- then each part as a chapter (its title as an h2). parts is how many
-- chapters, for the contents list at the top; null for a single piece.
ALTER TABLE posts ADD COLUMN parts INTEGER;
