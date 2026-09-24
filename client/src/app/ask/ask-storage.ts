/**
 * Where a tab keeps its conversation. Its own module so the About section can
 * ask "has this tab talked to the assistant?" without loading the assistant.
 */
export const ASK_STORAGE_KEY = "ask:v1";

export function hasStoredConversation(): boolean {
  try {
    return !!sessionStorage.getItem(ASK_STORAGE_KEY);
  } catch {
    return false;
  }
}
