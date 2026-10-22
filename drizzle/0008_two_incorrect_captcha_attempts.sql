-- Enforce a two-incorrect-answer limit for new and existing challenges.
ALTER TABLE captcha_challenges
  ALTER COLUMN max_attempts SET DEFAULT 2;

UPDATE captcha_challenges
SET max_attempts = 2,
    is_consumed = CASE WHEN attempts_count >= 2 THEN TRUE ELSE is_consumed END
WHERE max_attempts <> 2;
