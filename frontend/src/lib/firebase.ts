/**
 * Firebase initialization.
 *
 * Reads VITE_FIREBASE_* env vars. In dev with no env, falls back to a
 * deliberately-failing config so calls error early instead of silently leaking.
 *
 * Exports:
 *  - `auth, db` — initialized SDK handles
 *  - `authReady` — promise that resolves when first onAuthStateChanged fires
 *  - `signInAnonymouslyClient`, `onAuthStateChangedClient`
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  initializeAuth,
  onAuthStateChanged as fbOnAuthStateChanged,
  signInAnonymously as fbSignInAnonymously,
  signInWithPopup,
  signOut as fbSignOut,
  type Auth,
  type User as FirebaseUser,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readConfig(): FirebaseConfig {
  const env = import.meta.env;
  const cfg: FirebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: env.VITE_FIREBASE_APP_ID ?? "",
  };
  if (!cfg.apiKey || !cfg.projectId) {
     
    console.warn(
      "[firebase] Missing VITE_FIREBASE_* env vars. Auth + Firestore will not work.",
    );
  }
  return cfg;
}

const config = readConfig();
export const app: FirebaseApp = initializeApp(config);

// Use initializeAuth so we can pin persistence + future-proof for popups.
export const auth: Auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
});

export const db: Firestore = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/**
 * Resolves on the *first* auth state change after init.
 * Use this to gate API calls until we know whether the user is signed in
 * (anonymously or otherwise).
 */
export const authReady: Promise<FirebaseUser | null> = new Promise((resolve) => {
  const unsub = fbOnAuthStateChanged(auth, (user) => {
    unsub();
    resolve(user);
  });
});

export async function signInAnonymouslyClient(): Promise<FirebaseUser> {
  const cred = await fbSignInAnonymously(auth);
  return cred.user;
}

export async function signInWithGoogleClient(): Promise<FirebaseUser> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutClient(): Promise<void> {
  await fbSignOut(auth);
}

export const onAuthStateChangedClient = (
  cb: (user: FirebaseUser | null) => void,
): (() => void) => fbOnAuthStateChanged(auth, cb);

/**
 * Returns the current Firebase user's ID token, or null if signed out.
 * Cached + auto-refreshed by the SDK.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
