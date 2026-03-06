-- transact-qda: Initial schema
-- Transactional ontology: events are primary, elements are constituted by events

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project members
CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);

-- Events: every mutation is a naming/relating act
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  context_id UUID,
  data JSONB NOT NULL DEFAULT '{}',
  seq BIGSERIAL
);
CREATE INDEX idx_events_project ON events(project_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_seq ON events(seq);
CREATE INDEX idx_events_context ON events(context_id) WHERE context_id IS NOT NULL;

-- Elements: everything is an element (entities, relations, codes, memos, maps, documents)
CREATE TABLE elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('entity', 'relation', 'code', 'category', 'memo', 'map', 'document')),
  label TEXT NOT NULL,
  constituted_by UUID REFERENCES events(id),
  source_id UUID REFERENCES elements(id),
  target_id UUID REFERENCES elements(id),
  properties JSONB NOT NULL DEFAULT '{}',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_relation_endpoints CHECK (
    (kind = 'relation' AND source_id IS NOT NULL AND target_id IS NOT NULL)
    OR (kind != 'relation' AND source_id IS NULL AND target_id IS NULL)
  )
);
CREATE INDEX idx_elements_project ON elements(project_id);
CREATE INDEX idx_elements_kind ON elements(project_id, kind);
CREATE INDEX idx_elements_source ON elements(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_elements_target ON elements(target_id) WHERE target_id IS NOT NULL;
CREATE INDEX idx_elements_properties ON elements USING GIN (properties);

-- Element aspects: context-bound properties (Suenkel/Dewey)
CREATE TABLE element_aspects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  element_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  context_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (element_id, context_id)
);
CREATE INDEX idx_aspects_element ON element_aspects(element_id);
CREATE INDEX idx_aspects_context ON element_aspects(context_id);

-- Document content
CREATE TABLE document_content (
  element_id UUID PRIMARY KEY REFERENCES elements(id) ON DELETE CASCADE,
  full_text TEXT,
  file_path TEXT,
  mime_type TEXT,
  file_size BIGINT,
  thumbnail_path TEXT
);
CREATE INDEX idx_doc_fulltext ON document_content USING GIN (to_tsvector('german', coalesce(full_text, '')));
CREATE INDEX idx_doc_fulltext_en ON document_content USING GIN (to_tsvector('english', coalesce(full_text, '')));

-- Annotations (codes applied to document passages)
CREATE TABLE annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  constituted_by UUID REFERENCES events(id),
  anchor_type TEXT NOT NULL CHECK (anchor_type IN ('text', 'image_region')),
  anchor JSONB NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_annotations_project ON annotations(project_id);
CREATE INDEX idx_annotations_code ON annotations(code_id);
CREATE INDEX idx_annotations_document ON annotations(document_id);

-- Memo content
CREATE TABLE memo_content (
  element_id UUID PRIMARY KEY REFERENCES elements(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'html'
);

-- Memo links
CREATE TABLE memo_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'reference'
);
CREATE INDEX idx_memo_links_memo ON memo_links(memo_id);
CREATE INDEX idx_memo_links_target ON memo_links(target_id);

-- Code hierarchy
CREATE TABLE code_hierarchy (
  parent_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent_id, child_id)
);

-- AI interactions
CREATE TABLE ai_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id),
  request_type TEXT NOT NULL,
  model TEXT NOT NULL,
  input_context JSONB,
  response JSONB,
  accepted BOOLEAN,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_project ON ai_interactions(project_id);
