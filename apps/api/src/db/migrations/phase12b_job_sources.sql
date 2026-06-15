-- Phase 12b: Add UK job sources (CV-Library, Totaljobs, Guardian Jobs, NHS Jobs)
INSERT INTO job_sources (name, enabled, config) VALUES
  ('cv_library',    true, '{"base_url":"https://www.cv-library.co.uk/api/jobs","requires_key":true}'),
  ('totaljobs',     true, '{"type":"rss","base_url":"https://www.totaljobs.com/jobs"}'),
  ('guardian_jobs', true, '{"type":"rss","base_url":"https://jobs.theguardian.com/jobs"}'),
  ('nhs_jobs',      true, '{"base_url":"https://www.jobs.nhs.uk/api/v1/search","requires_key":false}')
ON CONFLICT (name) DO NOTHING;
