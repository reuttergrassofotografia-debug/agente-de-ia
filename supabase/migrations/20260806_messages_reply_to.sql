-- Fixes duplicate WhatsApp replies on BullMQ job retry: processMessage() had no
-- idempotency between generating the LLM reply, persisting it and sending it via
-- Evolution API. If a retry happened after evolution.sendText() already succeeded
-- (e.g. the following updateMessageStatus() call failed transiently), the job
-- reran from scratch and sent a second reply to the customer.
--
-- reply_to_message_id ties an assistant message to the user message that triggered
-- it. The partial unique index lets processor.ts upsert with onConflict +
-- ignoreDuplicates (same pattern already used for contacts and inbound messages),
-- so a retry reuses the row from any prior attempt instead of creating a new one.

alter table messages add column reply_to_message_id uuid references messages(id);

create unique index messages_reply_to_message_id_key
  on messages (reply_to_message_id)
  where reply_to_message_id is not null;
