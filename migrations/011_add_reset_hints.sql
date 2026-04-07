-- 011: Add reset_hints flag for admin hint testing
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_hints BOOLEAN DEFAULT false;
