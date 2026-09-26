/**
 * useStreamingAgent — consume the live reasoning stream for a single agent.
 *
 * Used by ReasoningSidebar (Cursor-style) and AgentCard "expand" view.
 */
import { useMemo } from "react";

import { useSession, type AgentReasoningChunk } from "./useSession";
import type { AgentName, AgentRecord } from "@/types/session";

export interface StreamingAgentState {
  agent: AgentName;
  record: AgentRecord | undefined;
  chunks: AgentReasoningChunk[];
  /** Concatenated text. */
  text: string;
  /** True if the agent is currently running. */
  isStreaming: boolean;
}

export function useStreamingAgent(
  sessionId: string | null,
  agent: AgentName,
): StreamingAgentState {
  const { session, reasoning } = useSession(sessionId);
  const chunks = useMemo(() => reasoning[agent] ?? [], [reasoning, agent]);
  const text = useMemo(() => chunks.map((c) => c.text).join(""), [chunks]);
  const record = session?.agents?.[agent];
  const isStreaming = record?.status === "running";

  return { agent, record, chunks, text, isStreaming };
}
