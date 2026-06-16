-- Phase 12b: Add UK job sources (CV-Library, Totaljobs, Guardian Jobs, NHS Jobs)
INSERT INTO job_sources (name, enabled, config) VALUES
  ('cv_library',    true, '{"base_url":"https://www.cv-library.co.uk/search-jobs-json","requires_key":true}'),
  ('greenhouse',    true, '{"type":"public_board","requires_key":false}'),
  ('lever',         true, '{"type":"public_board","requires_key":false}'),
  ('arbeitnow',     true, '{"base_url":"https://www.arbeitnow.com/api/job-board-api","requires_key":false}'),
  ('remoteok',      true, '{"base_url":"https://remoteok.com/api","requires_key":false}'),
  ('the_muse',      true, '{"base_url":"https://www.themuse.com/api/public/jobs","requires_key":false}')
ON CONFLICT (name) DO NOTHING;
