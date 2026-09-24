import type { RuntimeMessage } from "./types";

/** An extracting event starts a new job only in its own window. Results must
 * also match that window's current job ID. */
export function acceptsJobMessage(message: RuntimeMessage, windowId: number | null, activeJobId: string | null): boolean {
  if (windowId == null || message.windowId !== windowId) return false;
  return message.type === "ANALYZING" || message.jobId === activeJobId;
}

export interface SessionJob {
  jobId: string;
  status: "extracting" | "ready" | "error";
  extraction?: unknown;
  error?: string;
}

/** The presence of a saved record takes precedence over the cached extraction:
 * opening a sidebar must never start another paid request. */
export function resumeTarget(
  job: SessionJob | undefined,
  record: { jobId: string; recordId: string } | undefined,
  recordAvailable: boolean,
): "record" | "preview" | "extracting" | "error" | "empty" {
  if (job && record?.jobId === job.jobId && recordAvailable) return "record";
  if (job?.status === "ready" && job.extraction) return "preview";
  if (job?.status === "extracting") return "extracting";
  if (job?.status === "error") return "error";
  return "empty";
}
