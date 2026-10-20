CREATE TABLE IF NOT EXISTS support_tickets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_status_check CHECK (status IN ('open','in_progress','waiting_user','resolved','closed')),
  CONSTRAINT support_tickets_priority_check CHECK (priority IN ('low','normal','high','urgent'))
);
CREATE INDEX IF NOT EXISTS support_tickets_user_updated_idx ON support_tickets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_updated_idx ON support_tickets(status, updated_at DESC);
