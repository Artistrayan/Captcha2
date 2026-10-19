/**
 * ShieldCaptcha Shared Types
 * Production-ready definitions for Auth, Sites, Keys, Challenges, Verification, and Auditing.
 */

export type UserRole = 'USER' | 'ADMIN' | 'SUPPORT';
export type PlanTier = 'FREE' | 'GROWTH' | 'ENTERPRISE';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING';
export type ChallengeType = 'INVISIBLE' | 'PUZZLE' | 'IMAGE_SELECTION' | 'AUDIO';
export type ChallengeState = 'ISSUED' | 'SOLVED' | 'FAILED' | 'EXPIRED';
export type VerificationDecision = 'ALLOW' | 'BLOCK' | 'CHALLENGE_REQUIRED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface Site {
  id: string;
  userId: string;
  name: string;
  siteKey: string; // Public key format: sc_site_<base62>
  domains: string[]; // Whitelisted hostnames e.g. ['example.com', 'localhost']
  secretKeyPrefix: string; // e.g. sc_sec_...
  maskedSecretKey: string; // e.g. sc_secret_live_••••••••1a8f
  challengeDifficulty: 'LOW' | 'MEDIUM' | 'HIGH';
  invisibleEnabled: boolean;
  rateLimitPerMinute: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  siteId: string;
  hashedSecret: string; // Hashed with SHA-256
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface CaptchaChallenge {
  challengeId: string;
  siteKey: string;
  challengeType: ChallengeType;
  prompt: string;
  token: string; // One-time solve token
  options?: Array<{ id: string; label: string; icon?: string }>;
  expectedAnswer?: string;
  expiresAt: number; // Unix timestamp ms
  createdAt: number;
}

export interface VerificationResult {
  success: boolean;
  challenge_ts: string;
  hostname: string;
  action?: string;
  score: number; // 0.0 (bot) to 1.0 (human)
  development_mode: boolean;
  development_note?: string;
  error_codes?: string[];
  metadata?: {
    site_id: string;
    challenge_type: ChallengeType;
    latency_ms: number;
  };
}

export interface UsageRecord {
  id: string;
  siteId: string;
  date: string; // YYYY-MM-DD
  requestsCount: number;
  passedCount: number;
  failedCount: number;
  challengesIssued: number;
}

export interface Subscription {
  id: string;
  userId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  monthlyQuota: number;
  usedThisMonth: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ApiActivityLog {
  id: string;
  timestamp: string;
  siteKey: string;
  siteName: string;
  endpoint: string;
  method: string;
  clientIp: string;
  userAgent?: string;
  statusCode: number;
  decision: VerificationDecision;
  score?: number;
  latencyMs: number;
  notes?: string;
}
