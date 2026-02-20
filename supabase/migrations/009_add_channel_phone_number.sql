-- Migration 009: Add channel_phone_number to clients table
-- This field will be used to identify which client should handle each WhatsApp conversation
-- based on the channel_phone_number sent by 2chat webhook

-- Step 1: Add channel_phone_number column (nullable first to set values)
ALTER TABLE clients
ADD COLUMN channel_phone_number TEXT;

-- Step 2: Update existing client with the real WhatsApp Business number
UPDATE clients
SET channel_phone_number = '+573002710167'
WHERE name = 'Tienda de Zapatos Colombia';

-- Step 3: Make the column NOT NULL and UNIQUE
ALTER TABLE clients
ALTER COLUMN channel_phone_number SET NOT NULL;

ALTER TABLE clients
ADD CONSTRAINT clients_channel_phone_number_unique UNIQUE (channel_phone_number);

-- Step 4: Create index for fast lookups by channel_phone_number
CREATE INDEX idx_clients_channel_phone_number ON clients(channel_phone_number);

-- Verification query
SELECT
  id,
  name,
  channel_phone_number,
  business_type,
  active,
  created_at
FROM clients
ORDER BY created_at;
