/**
 * useBranching — branch creation + listing for a session.
 *
 * Listing reads sessions where parent_session_id == sessionId via Firestore.
 * Creation calls api.branch and returns the new session_id (UI redirects).
 */
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { api, APIError, type BranchRequest } from "@/lib/api";
import { db } from "@/lib/firebase";
import { useToast } from "./useToast";
import { track, Events } from "@/lib/analytics";
import { SessionSchema, type Session } from "@/types/session";

export interface BranchSummary {
  session_id: string;
  branch_name: string | null;
  status: Session["status"];
  created_at: string;
}

export interface UseBranching {
  branches: BranchSummary[];
  loading: boolean;
  creating: boolean;
  createBranch: (req: BranchRequest) => Promise<string | null>;
}

export function useBranching(sessionId: string | null): UseBranching {
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const { success, error } = useToast();

  useEffect(() => {
    if (!sessionId) {
      setBranches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "sessions"),
      where("parent_session_id", "==", sessionId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const out: BranchSummary[] = [];
        snap.forEach((d) => {
          const parsed = SessionSchema.safeParse({ ...d.data(), session_id: d.id });
          if (!parsed.success) return;
          const data = parsed.data;
          out.push({
            session_id: data.session_id,
            branch_name:
              typeof data.metadata?.branch_name === "string"
                ? (data.metadata.branch_name as string)
                : null,
            status: data.status,
            created_at: data.created_at,
          });
        });
        out.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
        setBranches(out);
        setLoading(false);
      },
      (err) => {
         
        console.warn("[branching] listener error", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [sessionId]);

  const createBranch = async (req: BranchRequest) => {
    setCreating(true);
    try {
      const res = await api.branch(req);
      success("Branch created", "Re-running selected agents on the new branch.");
      track(Events.BRANCH_CREATED, {
        parent_session_id: req.parent_session_id,
      });
      return res.session_id;
    } catch (err) {
      const msg =
        err instanceof APIError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Branch creation failed";
      error("Could not branch", msg);
      return null;
    } finally {
      setCreating(false);
    }
  };

  return { branches, loading, creating, createBranch };
}
