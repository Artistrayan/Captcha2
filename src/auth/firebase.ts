import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import jwt from 'jsonwebtoken';
import { dbRepository } from '../db/index.ts';
import { User } from '../db/schema.ts';

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const JWT_SECRET = process.env.SESSION_JWT_SECRET || (IS_PRODUCTION ? '' : 'local-development-only-jwt-secret-change-before-deploy');

if (IS_PRODUCTION && !JWT_SECRET) {
  throw new Error('[Auth] SESSION_JWT_SECRET is required in production; refusing to start with a default secret.');
}

export interface FirebaseAdminStatus {
  isInitialized: boolean;
  projectId?: string;
  authMode: 'firebase_admin_live' | 'development_session_jwt' | 'unavailable';
  missingConfig?: string[];
}

let isFirebaseAdminInitialized = false;
let initError: string | undefined;
let firebaseApp: App | undefined;
let firebaseAuth: Auth | undefined;

// Check Firebase credentials in environment
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (IS_PRODUCTION && !serviceAccountKey) {
  initError = 'FIREBASE_SERVICE_ACCOUNT_KEY is required in production.';
} else if (firebaseProjectId || serviceAccountKey) {
  try {
    if (getApps().length === 0) {
      if (serviceAccountKey) {
        const parsedKey = JSON.parse(serviceAccountKey);
        firebaseApp = initializeApp({
          credential: cert(parsedKey),
          projectId: parsedKey.project_id || firebaseProjectId,
        });
      } else {
        firebaseApp = initializeApp({
          projectId: firebaseProjectId,
        });
      }
      firebaseAuth = getAuth(firebaseApp);
      isFirebaseAdminInitialized = true;
      console.log('[Auth] Firebase Admin SDK initialized successfully for project:', firebaseProjectId);
    }
  } catch (err: any) {
    initError = err?.message;
    console.warn('[Auth] Firebase Admin initialization failed:', err?.message);
  }
}

export function getFirebaseStatus(): FirebaseAdminStatus {
  const missing: string[] = [];
  if (!firebaseProjectId) missing.push('FIREBASE_PROJECT_ID');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) missing.push('FIREBASE_SERVICE_ACCOUNT_KEY');

  return {
    isInitialized: isFirebaseAdminInitialized,
    projectId: firebaseProjectId,
    authMode: isFirebaseAdminInitialized ? 'firebase_admin_live' : (IS_PRODUCTION ? 'unavailable' : 'development_session_jwt'),
    missingConfig: missing.length > 0 ? missing : undefined,
  };
}

export interface DecodedAuthToken {
  uid: string;
  email: string;
  name?: string;
  role?: string;
}

/**
 * Validates token server-side.
 * First tries Firebase Admin verifyIdToken if available.
 * If development JWT or Firebase mock is used, verifies signature using JWT_SECRET.
 * Never trusts unverified client claims!
 */
export async function verifyTokenServerSide(token: string): Promise<DecodedAuthToken> {
  if (!token || typeof token !== 'string') {
    throw new Error('No authentication token provided');
  }

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();

  // 1. Verify if token is a server session JWT signed by SESSION_JWT_SECRET
  try {
    if (!JWT_SECRET) throw new Error('JWT secret is not configured');
    const verified = jwt.verify(cleanToken, JWT_SECRET) as any;
    if (verified && verified.uid && verified.email) {
      return {
        uid: verified.uid,
        email: verified.email,
        name: verified.name || verified.email.split('@')[0],
        role: verified.role || 'USER',
      };
    }
  } catch {
    // Not a server session JWT, proceed to check if it is a Firebase ID Token
  }

  // 2. Verify with Firebase Admin SDK if live and initialized
  if (isFirebaseAdminInitialized && firebaseAuth) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(cleanToken);
      if (!decoded.uid || !decoded.email) {
        throw new Error('Invalid Firebase token claims: missing uid or email');
      }
      return {
        uid: decoded.uid,
        email: decoded.email,
        name: decoded.name || decoded.email.split('@')[0],
      };
    } catch (fbErr: any) {
      throw new Error(`Authentication token verification failed: ${fbErr.message}`);
    }
  }

  throw new Error('Invalid authentication token: signature verification failed');
}

/**
 * Creates a signed session token using server private secret (valid in dev and production).
 */
export function createSessionToken(user: { uid: string; email: string; name?: string; role?: string }): string {
  if (!JWT_SECRET) {
    throw new Error('SESSION_JWT_SECRET is required to create session tokens');
  }
  return jwt.sign(
    {
      uid: user.uid,
      email: user.email,
      name: user.name,
      role: user.role || 'USER',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export const createDevSessionToken = createSessionToken;

/**
 * Gets or creates user in PostgreSQL / database based on verified token payload.
 */
export async function getOrCreateUser(decoded: DecodedAuthToken): Promise<User> {
  // Check by Firebase UID first
  let user = await dbRepository.getUserByFirebaseUid(decoded.uid);
  if (user) {
    return user;
  }

  // Check by email in case user existed
  user = await dbRepository.getUserByEmail(decoded.email);
  if (user) {
    return user;
  }

  // Create new user securely
  user = await dbRepository.createUser({
    firebaseUid: decoded.uid,
    email: decoded.email,
    name: decoded.name || decoded.email.split('@')[0],
    role: decoded.role || 'USER',
  });

  return user;
}
