-- Add back-view cutout support for the 2.5D mannequin view.
-- image_cutout_back_key is nullable: most existing items have only a front view.
-- image_angles is a JSONB escape hatch for future angles (side, 3/4, etc.)

ALTER TABLE items
  ADD COLUMN image_cutout_back_key text,
  ADD COLUMN image_angles jsonb not null default '[]'::jsonb;