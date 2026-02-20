-- =============================================================================
-- Migration 015: Eliminar columnas sin uso de la tabla leads
-- current_phase: nunca se leía ni se usaba para tomar decisiones
-- name: se escribía al crear el lead pero nunca se leía en el flujo
-- =============================================================================

ALTER TABLE leads
  DROP COLUMN IF EXISTS current_phase,
  DROP COLUMN IF EXISTS name;
