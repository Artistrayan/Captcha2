-- Enforce a two-incorrect-answer limit for new and existing challenges.
ALTER TABLE captcha_challenges
  ALTER COLUMN max_attempts SET DEFAULT 2;

UPDATE captcha_challenges
SET max_attempts = 2
WHERE max_attempts <> 2;

-- Any challenge that has already reached the new limit must no longer be usable.
UPDATE captcha_challenges
SET is_consumed = TRUE
WHERE attempts_count >= 2 AND is_consumed = FALSE;
