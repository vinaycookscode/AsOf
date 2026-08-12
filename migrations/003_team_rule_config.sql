-- B26: per-team workflow mapping (done_statuses/in_progress_statuses/blocked_statuses, set at
-- onboarding per design-spec.md §2.1) needs somewhere to live. rule_config already exists
-- (001_init.sql) for per-rule thresholds/enabled/slack_delivery -- this is the other half.
ALTER TABLE team ADD COLUMN status_category_map jsonb NOT NULL DEFAULT '{}'::jsonb;
