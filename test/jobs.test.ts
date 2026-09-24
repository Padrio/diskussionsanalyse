import { expect, test } from "vitest";
import { acceptsJobMessage, resumeTarget } from "../src/lib/jobs";
import type { RuntimeMessage } from "../src/lib/types";

test("result events are scoped to both browser window and current job", () => {
  const result: RuntimeMessage = { type: "EXTRACTION_RESULT", windowId: 7, jobId: "new",
    payload: { url: "https://x.test", title: "x", siteType: "generic", article: null,
      comments: [], stats: { commentCount: 0, charCount: 0 }, truncated: false } };
  expect(acceptsJobMessage(result, 7, "new")).toBe(true);
  expect(acceptsJobMessage(result, 8, "new")).toBe(false);
  expect(acceptsJobMessage(result, 7, "old")).toBe(false);
  expect(acceptsJobMessage(result, null, "new")).toBe(false);
  expect(acceptsJobMessage({ type: "ANALYZING", windowId: 7, jobId: "next" }, 7, "new")).toBe(true);
});

test("reopening a completed or partial job restores the record before considering extraction", () => {
  const job = { jobId: "j1", status: "ready" as const, extraction: {} };
  expect(resumeTarget(job, { jobId: "j1", recordId: "r1" }, true)).toBe("record");
  expect(resumeTarget(job, { jobId: "j1", recordId: "r1" }, false)).toBe("preview");
  expect(resumeTarget(job, { jobId: "old", recordId: "r1" }, true)).toBe("preview");
  expect(resumeTarget({ jobId: "j2", status: "extracting" }, undefined, false)).toBe("extracting");
});
