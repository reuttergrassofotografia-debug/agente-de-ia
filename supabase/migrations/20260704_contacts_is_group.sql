-- Add group flag to contacts.
-- Group chats are stored as contacts (phone = group JID without @g.us) so the CRM
-- can display them, but the AI never auto-replies in groups.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE;
