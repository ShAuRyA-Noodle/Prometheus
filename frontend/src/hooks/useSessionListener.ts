/**
 * useSessionListener — Firestore onSnapshot wrapper for a single session doc.
 *
 * Returns the live session, plus optional artifact subdocs as they arrive.
 *
 * Path convention (matches backend services):
 *  sessions/{session_id}                      — Session doc
 *  sessions/{session_id}/artifacts/{name}     — agent output subdoc per name
 */
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type FirestoreError,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { SessionSchema, type Session, type AgentName } from "@/types/session";

export interface SessionListenerState {
  session: Session | null;
  artifacts: Partial<Record<AgentName, unknown>>;
  loading: boolean;
  error: FirestoreError | null;
}

export function useSessionListener(
  sessionId: string | null,
): SessionListenerState {
  const [session, setSession] = useState<Session | null>(null);
  const [artifacts, setArtifacts] = useState<Partial<Record<AgentName, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setArtifacts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const sessionRef = doc(db, "sessions", sessionId);
    const unsubSession = onSnapshot(
      sessionRef,
      (snap) => {
        if (!snap.exists()) {
          setSession(null);
          setLoading(false);
          return;
        }
        const data: DocumentData = snap.data();
        const parsed = SessionSchema.safeParse({ ...data, session_id: snap.id });
        if (parsed.success) {
          setSession(parsed.data);
        } else {
           
          console.warn("[session] schema mismatch", parsed.error.issues);
        }
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    const artifactsRef = collection(db, "sessions", sessionId, "artifacts");
    const unsubArtifacts = onSnapshot(
      artifactsRef,
      (snap) => {
        const next: Partial<Record<AgentName, unknown>> = {};
        snap.forEach((d) => {
          next[d.id as AgentName] = d.data();
        });
        setArtifacts(next);
      },
      (err) => setError(err),
    );

    return () => {
      unsubSession();
      unsubArtifacts();
    };
  }, [sessionId]);

  return { session, artifacts, loading, error };
}
