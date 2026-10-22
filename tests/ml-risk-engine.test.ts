import { describe, expect, it } from 'vitest';
import { predictCaptchaMLShadow } from '../src/captcha/ml-risk-engine.ts';

describe('ML scorer', () => {
  it('does not claim a model exists before a trained artifact is configured', () => {
    delete process.env.SHIELDCAPTCHA_ML_MODEL_PATH;
    expect(predictCaptchaMLShadow({}).available).toBe(false);
  });
});
