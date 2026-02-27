-- Migration 036: Scope lead uniqueness to (phone, client_id)
--
-- BUG FIX: El constraint UNIQUE(phone) permitía que un número de teléfono
-- existiera una sola vez en toda la tabla, sin importar el cliente.
-- Esto causaba que pausar el bot en un cliente afectara a TODOS los clientes
-- que tuvieran el mismo lead.
--
-- La unicidad correcta para un sistema multi-tenant es (phone, client_id):
-- el mismo número puede ser lead de múltiples clientes de forma independiente.
--
-- PRECAUCIÓN: Si existen filas duplicadas en (phone, client_id), este ALTER fallará.
-- Verificar antes de ejecutar:
-- SELECT phone, client_id, COUNT(*) FROM leads GROUP BY phone, client_id HAVING COUNT(*) > 1;

-- 1. Eliminar el constraint único existente en phone
ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_phone_key;

-- 2. Eliminar índice secundario simple si existe
DROP INDEX IF EXISTS idx_leads_phone;

-- 3. Agregar constraint compuesto (phone, client_id)
ALTER TABLE leads
  ADD CONSTRAINT leads_phone_client_id_key UNIQUE (phone, client_id);

-- 4. Índice compuesto para lookups rápidos por (phone, client_id)
CREATE INDEX idx_leads_phone_client_id ON leads(phone, client_id);
