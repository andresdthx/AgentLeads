# Guía: Sistema Multi-Tenant con Prompts por Cliente

## 📋 Overview

El sistema ahora soporta **múltiples clientes** con **prompts personalizados** por cada uno.

## 🗄️ Nueva Estructura

### Tabla: `clients`

```sql
clients
├── id (UUID)
├── name (TEXT) - Nombre del cliente
├── business_type (TEXT) - Tipo de negocio
├── active (BOOLEAN) - Cliente activo/inactivo
├── system_prompt (TEXT) - Prompt personalizado
├── llm_model (TEXT) - Modelo LLM (ej: gpt-4o-mini)
├── llm_temperature (NUMERIC) - Temperature (0.0-1.0)
├── conversation_history_limit (INTEGER) - Límite de historial
├── created_at, updated_at
```

### Tabla: `leads` (actualizada)

```sql
leads
├── id, phone, name...
├── client_id (UUID) → clients.id  ← NUEVO
├── classification, score, etc...
```

## 🚀 Cómo Funciona

### 1. Cliente por Defecto

Ya existe un cliente por defecto creado automáticamente:
- Nombre: "Default Client"
- Todos los leads sin `client_id` usan este cliente

### 2. Crear Nuevo Cliente

```sql
INSERT INTO clients (
  name,
  business_type,
  system_prompt,
  llm_model,
  llm_temperature,
  conversation_history_limit
) VALUES (
  'Tienda de Ropa',
  'E-commerce',
  'Eres un agente de ventas de ropa.
   Ayuda a los clientes a encontrar prendas perfectas.
   Tono casual y moderno.

   [resto del prompt...]',
  'gpt-4o-mini',
  0.7,
  10
);
```

### 3. Asignar Cliente a Lead

**Opción A: Al crear el lead**
```typescript
// En lead.ts, modificar createLead para aceptar client_id
await supabase.from("leads").insert({
  phone,
  name,
  client_id: 'uuid-del-cliente'
})
```

**Opción B: Por webhook/número**
```sql
-- Asociar número de WhatsApp con cliente específico
UPDATE leads
SET client_id = 'uuid-del-cliente'
WHERE phone = '+1234567890';
```

**Opción C: Automático por routing**
- Configurar en 2chat/webhook diferentes URLs por cliente
- Agregar parámetro `client_id` al webhook

## 📝 Ejemplos de Prompts por Cliente

### Cliente 1: Tienda de Ropa
```
Eres agente de ventas de ropa femenina.
Estilo moderno, casual, amigable.
Enfócate en: tallas, colores, ocasiones.
```

### Cliente 2: Agencia de Viajes
```
Eres agente de viajes.
Ayuda a planear destinos y paquetes.
Enfócate en: fechas, presupuesto, preferencias.
```

### Cliente 3: Inmobiliaria
```
Eres agente inmobiliario.
Ayuda a encontrar propiedades.
Enfócate en: ubicación, precio, características.
```

## 🔧 Gestión de Clientes

### Ver todos los clientes
```sql
SELECT id, name, business_type, active, llm_model
FROM clients
ORDER BY name;
```

### Actualizar prompt de un cliente
```sql
UPDATE clients
SET system_prompt = 'Nuevo prompt aquí...'
WHERE name = 'Tienda de Ropa';
```

### Desactivar cliente
```sql
UPDATE clients
SET active = false
WHERE id = 'uuid-del-cliente';
```

### Ver leads por cliente
```sql
SELECT
  c.name as cliente,
  COUNT(l.id) as total_leads,
  COUNT(CASE WHEN l.classification = 'hot' THEN 1 END) as hot_leads
FROM clients c
LEFT JOIN leads l ON l.client_id = c.id
GROUP BY c.id, c.name;
```

## 🎯 Routing por Cliente

### Opción 1: URL Parameters
```
https://[project].supabase.co/functions/v1/webhook-whatsapp?client_id=xxx
```

### Opción 2: Headers
```javascript
headers: {
  'X-Client-ID': 'uuid-del-cliente'
}
```

### Opción 3: Por número de WhatsApp
- Mantener tabla de mapping: `phone_number → client_id`
- Buscar al recibir webhook

## 📊 Análisis por Cliente

```sql
-- Performance por cliente
SELECT
  c.name,
  AVG(l.score) as avg_score,
  COUNT(CASE WHEN l.classification = 'hot' THEN 1 END) * 100.0 / COUNT(*) as hot_percentage
FROM clients c
LEFT JOIN leads l ON l.client_id = c.id
WHERE l.created_at >= NOW() - INTERVAL '30 days'
GROUP BY c.id, c.name;
```

## 🔄 Flujo Actual

```
1. Webhook llega
2. Se crea/obtiene lead
3. Se obtiene configuración del cliente (client.ts)
   - Si lead tiene client_id → usa ese cliente
   - Si no → usa Default Client
4. Se carga prompt + config del cliente
5. Se genera respuesta con ese prompt
6. Se guarda y envía
```

## ⚙️ Configuración Avanzada

### Diferentes modelos por cliente
```sql
-- Cliente premium con GPT-4
UPDATE clients
SET llm_model = 'gpt-4',
    llm_temperature = 0.5
WHERE name = 'Cliente VIP';
```

### Límites de historial por cliente
```sql
-- Cliente que necesita más contexto
UPDATE clients
SET conversation_history_limit = 20
WHERE business_type = 'Soporte Técnico';
```

## 🚨 Importante

- ✅ Los prompts se cargan desde BD en **cada request**
- ✅ Cambios en prompts son **inmediatos** (no requiere redeploy)
- ✅ Fallback automático a Default Client si no hay client_id
- ⚠️ No eliminar Default Client (sistema lo requiere)
- ⚠️ Validar prompts antes de actualizar en producción

## 📖 Próximos Pasos

1. Aplicar migración: `npx supabase db push`
2. Verificar Default Client fue creado
3. Crear clientes adicionales según necesidad
4. Implementar routing por cliente (URL/header/phone)
5. Monitorear performance por cliente
