export function shortSpeech(summary: unknown) {
  const raw = String(summary ?? "").trim();
  if (raw) {
    const block = raw.split(/\*\*[^*]+\*\*/).filter(Boolean).at(-1) ?? raw;
    const sentences = block.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    const excerpt = sentences.slice(-2).join(" ") || block;
    return excerpt.slice(0, 320).replace(/[,:;\s]+$/, "") + (excerpt.length > 320 ? "…" : "");
  }
  return "";
}
