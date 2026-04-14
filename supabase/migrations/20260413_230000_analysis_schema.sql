create schema if not exists analysis;

create table if not exists analysis.client_sessions (
  session_id uuid primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  locale text,
  source_channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists analysis.analysis_records (
  analysis_id uuid primary key,
  request_id text not null unique,
  session_id uuid references analysis.client_sessions(session_id),
  processing_state text not null check (
    processing_state in ('received', 'completed', 'failed')
  ),
  status_code text check (
    status_code in (
      'INSUFFICIENT_INFO',
      'TARGET_TOO_HIGH_OR_CONFLICT',
      'NO_CLEAR_CANDIDATES',
      'HAS_CANDIDATES'
    )
  ),
  status_label text,
  rules_passed boolean,
  rule_status_code text,
  budget integer not null check (budget > 0),
  target_return_reference integer not null check (
    target_return_reference >= 0 and target_return_reference <= 100
  ),
  risk_tolerance text not null,
  investment_cycle text not null,
  volatility_acceptance boolean not null,
  style_preference text not null,
  industry_preference_json jsonb not null default '[]'::jsonb,
  normalized_request_json jsonb not null,
  rule_results_json jsonb,
  round_trace_json jsonb,
  final_response_json jsonb,
  search_rounds_used integer not null default 0 check (
    search_rounds_used >= 0 and search_rounds_used <= 4
  ),
  duration_ms integer,
  model_call_count integer not null default 0 check (model_call_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists analysis.analysis_candidates (
  candidate_id uuid primary key,
  analysis_id uuid not null references analysis.analysis_records(analysis_id) on delete cascade,
  display_order integer not null check (display_order >= 1 and display_order <= 5),
  stock_name text not null,
  stock_code text not null,
  industry text,
  selection_reason text not null,
  evidence_summary text not null,
  major_risks text not null,
  uncertainties text not null,
  confidence_level text not null check (
    confidence_level in ('HIGH', 'MEDIUM', 'LOW')
  ),
  confidence_score integer not null check (
    confidence_score >= 0 and confidence_score <= 100
  ),
  created_at timestamptz not null default now(),
  unique (analysis_id, display_order)
);

create table if not exists analysis.candidate_evidence (
  evidence_id uuid primary key,
  analysis_id uuid not null references analysis.analysis_records(analysis_id) on delete cascade,
  candidate_id uuid not null references analysis.analysis_candidates(candidate_id) on delete cascade,
  source_level text not null check (source_level in ('L1', 'L2', 'L3', 'L4')),
  source_name text not null,
  source_domain text not null,
  title text not null,
  url text not null,
  publish_date date,
  snippet text not null,
  is_core_evidence boolean not null,
  is_valid_after_gatekeeper boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_analysis_records_session_id_created_at
  on analysis.analysis_records (session_id, created_at desc);

create index if not exists idx_analysis_records_processing_state_created_at
  on analysis.analysis_records (processing_state, created_at desc);

create index if not exists idx_analysis_records_status_code_created_at
  on analysis.analysis_records (status_code, created_at desc);

create index if not exists idx_analysis_candidates_analysis_id_display_order
  on analysis.analysis_candidates (analysis_id, display_order);

create index if not exists idx_candidate_evidence_candidate_id
  on analysis.candidate_evidence (candidate_id);

create index if not exists idx_candidate_evidence_source_domain
  on analysis.candidate_evidence (source_domain);
