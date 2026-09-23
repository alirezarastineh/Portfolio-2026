import adminCss from "../../admin.css?inline";

export const ADMIN_STYLES_ID = "admin-styles";

/**
 * Adds the admin's stylesheet (src/admin.css) to the document once. Inlined
 * into the admin's lazy chunk rather than linked from index.html, so visitors
 * never download it. Runs during the server render too, so the HTML arrives
 * with it; the browser then finds it by id and does not add a second copy.
 */
export function addAdminStyles(doc: Document): void {
  if (doc.getElementById(ADMIN_STYLES_ID)) return;
  const style = doc.createElement("style");
  style.id = ADMIN_STYLES_ID;
  style.textContent = adminCss;
  doc.head.appendChild(style);
}
