-- Pictures in pieces. Fold MD shrinks each one, strips where it was taken,
-- and uploads it under the SHA-256 of its bytes; the bytes live in R2
-- (binding IMAGES) under that same hash, and the piece links /img/<hash>.
-- The same picture is stored once, however many pieces use it.
CREATE TABLE images (
  hash TEXT PRIMARY KEY,          -- hex SHA-256 of the bytes; also the R2 key
  type TEXT NOT NULL,             -- image/jpeg, image/png, image/gif or image/webp
  bytes INTEGER NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- Which pieces use which pictures. A picture no piece uses is removed (see
-- images.server.ts), right away when its piece goes, or a day after an
-- upload that was never published.
CREATE TABLE post_images (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  hash TEXT NOT NULL REFERENCES images(hash),
  PRIMARY KEY (post_id, hash)
);
CREATE INDEX post_images_by_hash ON post_images (hash);
