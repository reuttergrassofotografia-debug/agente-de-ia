-- Adds explicit salesperson ownership to WhatsApp contacts, so the CRM inbox
-- can be restricted per-vendedor. Nullable: a contact with no owner yet is
-- still visible to admin/gerente, just not to any vendedor until assigned
-- (automatically, on first reply sent via the CRM, or manually by admin/gerente).
alter table contacts add column if not exists responsavel_id uuid references profiles(id);
