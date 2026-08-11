-- B35: correct/ignore/snooze feedback actions need a snooze expiry on the finding itself
-- (suppression from 'ignore' is permanent and lives in the suppression table already).
ALTER TABLE finding ADD COLUMN snoozed_until timestamptz;
