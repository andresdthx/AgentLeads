-- Agrega debounce_ms por cliente para controlar el tiempo de agrupamiento
-- de mensajes rápidos en la cola. Si es NULL, se usa el valor global del
-- env var DEBOUNCE_MS (default 6000 ms).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS debounce_ms INTEGER DEFAULT NULL
    CONSTRAINT clients_debounce_ms_check CHECK (debounce_ms IS NULL OR debounce_ms BETWEEN 500 AND 30000);

COMMENT ON COLUMN clients.debounce_ms IS
  'Tiempo de debounce en ms para agrupar mensajes rápidos del lead. NULL = usar env var DEBOUNCE_MS (default 6000).';
