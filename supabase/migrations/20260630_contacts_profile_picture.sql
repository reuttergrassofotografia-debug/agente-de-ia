-- Add profile picture URL to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
