-- Phase 3: Human Handoff
-- 1. Allow 'paused' status in conversations
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('active', 'closed', 'paused'));

-- 2. Scheduled messages table
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  content       TEXT NOT NULL DEFAULT '',
  media_base64  TEXT,
  media_type    TEXT NOT NULL DEFAULT 'text' CHECK (media_type IN ('text', 'image', 'audio')),
  mimetype      TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_messages_pending_idx
  ON scheduled_messages (scheduled_at)
  WHERE status = 'pending';
