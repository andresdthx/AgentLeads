# AgentsLeads - WhatsApp Lead Qualification System

Sistema de calificación de leads por WhatsApp usando Supabase Edge Functions y AI.

## 🚀 Características

- ✅ Recepción de mensajes de WhatsApp vía webhook (2chat)
- ✅ Calificación inteligente de leads con GPT-4o-mini
- ✅ Sistema de clasificación: Hot (70-100) / Warm (40-69) / Cold (0-39)
- ✅ Extracción automática de datos (necesidad, timeline, presupuesto, autoridad)
- ✅ Historial de conversación persistente
- ✅ Respuestas naturales y conversacionales
- ✅ Arquitectura modular y escalable

## 📁 Estructura del Proyecto

```
AgentsLeads/
├── package.json              # Scripts y dependencias
├── .env                      # Variables de entorno (no versionado)
├── .gitignore               # Archivos ignorados por git
└── supabase/
    ├── .vscode/
    │   └── mcp.json         # Configuración MCP
    └── functions/
        └── webhook-whatsapp/
            ├── .funcignore  # Archivos excluidos del deploy
            ├── deno.json    # Configuración Deno
            ├── index.ts     # Entry point
            ├── handlers/    # Orquestadores
            ├── services/    # Lógica de negocio
            ├── config/      # Configuración
            ├── types/       # Definiciones TypeScript
            └── __tests__/   # Suite de tests (excluida del deploy)
```

## ⚙️ Configuración

### 1. Variables de Entorno

Crea un archivo `.env` en la raíz:

```bash
# Supabase
SUPABASE_ACCESS_TOKEN=tu_token_aqui
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key

# WhatsApp (2chat)
TWOCHAT_API_KEY=tu_api_key
TWOCHAT_FROM_NUMBER=+1234567890
WPP_ORQUESTER_PROVIDER_URL=https://api.p.2chat.io
WPP_ORQUESTER_PROVIDER_PATH=/open/whatsapp/send-message

# OpenAI LLM
LLM_API_KEY=tu_openai_key
LLM_OPEN_IA_CHAT_URL=https://api.openai.com
LLM_OPEN_IA_CHAT_URL_PATH=/v1/chat/completions
```

### 2. Instalar Dependencias

```bash
npm install
```

### 3. Vincular Proyecto Supabase

```bash
npm run link
# o
npx supabase link --project-ref tu-project-ref
```

## 🚀 Deployment

### Deploy a Producción

```bash
npm run deploy:prod
```

### Ver Logs

```bash
npm run logs
```

### Scripts Disponibles

```json
{
  "dev": "Inicia Supabase localmente",
  "deploy": "Deploy genérico",
  "deploy:prod": "Deploy a producción",
  "logs": "Ver logs de la función",
  "test": "Ejecutar tests",
  "test:watch": "Tests en modo watch"
}
```

## 🧪 Tests

El proyecto incluye 41 tests unitarios con Deno Test.

### Ejecutar Tests

```bash
npm test
# o
cd supabase/functions/webhook-whatsapp && deno task test
```

### Coverage

```bash
cd supabase/functions/webhook-whatsapp
deno task test:coverage
deno task coverage
```

Ver más en [supabase/functions/webhook-whatsapp/__tests__/README.md](supabase/functions/webhook-whatsapp/__tests__/README.md)

## 📊 Base de Datos

### Tablas Requeridas

#### `leads`
```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  classification TEXT CHECK (classification IN ('hot', 'warm', 'cold')),
  score INTEGER CHECK (score >= 0 AND score <= 100),
  extracted_data JSONB,
  current_phase TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);
```

#### `messages`
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 🔧 Configuración del Webhook

1. Despliega la función a Supabase
2. URL del webhook: `https://[project-ref].supabase.co/functions/v1/webhook-whatsapp`
3. Configura en 2chat:
   - URL: La URL de arriba
   - Método: POST
   - Headers: `Authorization: Bearer [anon-key]`

## 📝 Flujo de Trabajo

1. Usuario envía mensaje por WhatsApp
2. 2chat envía webhook a Supabase
3. Edge Function procesa:
   - Crea/obtiene lead
   - Guarda mensaje del usuario
   - Obtiene historial (últimos 10 mensajes)
   - Genera respuesta con GPT-4o-mini
   - Extrae clasificación si está lista
   - Guarda respuesta
   - Envía mensaje por WhatsApp
4. Proceso se repite por cada mensaje

## 🎯 Sistema de Calificación

El sistema hace máximo 4 preguntas clave:
- ¿Qué necesita?
- ¿Para cuándo?
- ¿Presupuesto aproximado?
- ¿Es quien toma la decisión?

Clasificación automática:
- **Hot (70-100)**: Alta intención, presupuesto claro, urgencia
- **Warm (40-69)**: Interés moderado, requiere seguimiento
- **Cold (0-39)**: Baja intención o no califica

## 🛡️ Archivos Excluidos del Deploy

El archivo `.funcignore` excluye del deploy:
- Tests (`__tests__/`)
- Documentación (`.md`)
- Configuración de desarrollo (`deno.json`)
- Coverage reports
- Archivos temporales

## 📦 Deploy Optimizado

Solo se despliegan los archivos necesarios:
- Código fuente (`index.ts`, `handlers/`, `services/`, `config/`, `types/`)
- Dependencias importadas automáticamente por Deno

Tamaño típico del deploy: ~20KB

## 🔗 Enlaces Útiles

- **Dashboard**: https://supabase.com/dashboard/project/pgwklddzkizicqigvipf
- **Functions**: https://supabase.com/dashboard/project/pgwklddzkizicqigvipf/functions
- **Logs**: https://supabase.com/dashboard/project/pgwklddzkizicqigvipf/logs/edge-functions

## 🤝 Contribuir

1. Crea una branch para tu feature
2. Escribe tests para nuevas funcionalidades
3. Asegura que todos los tests pasen
4. Haz commit con mensajes descriptivos
5. Crea un pull request

## 📄 Licencia

MIT
