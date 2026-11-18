ALTER TABLE clients ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);
