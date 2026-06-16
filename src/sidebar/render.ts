import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

export interface Section {
  title: string;
  bodyMd: string;
  isBias: boolean;
}

export function splitSections(md: string): Section[] {
  const parts = md.split(/^##\s+/m).filter((p) => p.trim());
  return parts.map((p) => {
    const nl = p.indexOf("\n");
    const title = (nl === -1 ? p : p.slice(0, nl)).trim();
    const bodyMd = nl === -1 ? "" : p.slice(nl + 1).trim();
    return { title, bodyMd, isBias: /bias|tendenz/i.test(title) };
  });
}
