# Database Migrations

## 📊 Schema Overview

### Tables Created

#### `leads` - Lead Information
Stores lead contact information and classification data.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | NO | Primary key (auto-generated) |
| `phone` | TEXT | NO | WhatsApp phone number (unique) |
| `name` | TEXT | YES | Contact name |
| `classification` | TEXT | YES | Lead temperature: hot/warm/cold |
| `score` | INTEGER | YES | Lead score (0-100) |
| `extracted_data` | JSONB | YES | Extracted data: {need, timeline, budget, authority} |
| `current_phase` | TEXT | YES | Current phase: new, classified, etc. |
| `created_at` | TIMESTAMPTZ | NO | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | YES | Last update timestamp (auto-updated) |

**Constraints:**
- `phone` must be unique
- `classification` must be 'hot', 'warm', or 'cold'
- `score` must be between 0 and 100

**Indexes:**
- `idx_leads_phone` - Fast lookup by phone
- `idx_leads_classification` - Filter by classification
- `idx_leads_score` - Sort by score
- `idx_leads_created_at` - Sort by creation date

#### `messages` - Conversation History
Stores all messages between user and assistant.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | NO | Primary key (auto-generated) |
| `lead_id` | UUID | NO | Reference to leads table |
| `role` | TEXT | NO | Message sender: user/assistant |
| `content` | TEXT | NO | Message text content |
| `created_at` | TIMESTAMPTZ | NO | Message timestamp |

**Constraints:**
- `role` must be 'user' or 'assistant'
- `lead_id` references `leads(id)` with CASCADE delete

**Indexes:**
- `idx_messages_lead_id` - Fast lookup by lead
- `idx_messages_created_at` - Sort by date
- `idx_messages_lead_created` - Combined index for conversation history

### Features

✅ **Row Level Security (RLS)** enabled on both tables
✅ **Automatic timestamps** with triggers
✅ **Optimized indexes** for fast queries
✅ **Proper constraints** for data integrity
✅ **Service role policies** for Edge Functions access

## 🔐 Security

Both tables have RLS enabled with policies allowing full access to the `service_role`.

```sql
-- Service role has full access
CREATE POLICY "Service role has full access to leads"
  ON leads FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

## 🚀 Migrations

### Apply Migration
```bash
export SUPABASE_ACCESS_TOKEN="your_token"
npx supabase db push
```

### Verify Tables
Execute `verify_tables.sql` in Supabase SQL Editor to check the structure.

### Reset Database
If you need to recreate from scratch:
```sql
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
```
Then rerun the migration.

## 📝 Migration History

| # | File | Date | Description |
|---|------|------|-------------|
| 001 | `001_recreate_tables.sql` | 2026-02-15 | Initial schema with leads and messages tables |

## 🔍 Useful Queries

### Get all hot leads
```sql
SELECT * FROM leads
WHERE classification = 'hot'
ORDER BY score DESC;
```

### Get conversation history for a lead
```sql
SELECT role, content, created_at
FROM messages
WHERE lead_id = 'lead-uuid-here'
ORDER BY created_at ASC;
```

### Get lead with full conversation
```sql
SELECT
  l.*,
  json_agg(
    json_build_object(
      'role', m.role,
      'content', m.content,
      'created_at', m.created_at
    ) ORDER BY m.created_at
  ) as messages
FROM leads l
LEFT JOIN messages m ON m.lead_id = l.id
WHERE l.phone = '+1234567890'
GROUP BY l.id;
```

### Get leads classified in last 24h
```sql
SELECT phone, name, classification, score
FROM leads
WHERE updated_at >= NOW() - INTERVAL '24 hours'
  AND classification IS NOT NULL
ORDER BY score DESC;
```

## 📊 Performance Notes

- Indexes are optimized for common query patterns
- JSONB allows flexible extracted_data structure
- Timestamps use TIMESTAMPTZ for timezone support
- Cascade delete ensures orphaned messages are removed
- Combined indexes support efficient conversation retrieval

## 🔄 Auto-Update Trigger

The `updated_at` column in `leads` automatically updates on any change:

```sql
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```
