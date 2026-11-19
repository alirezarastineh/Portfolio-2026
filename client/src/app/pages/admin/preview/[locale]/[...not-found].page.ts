import { previewMeta } from "../../../../admin/preview/preview-route";
import { routeMeta as live } from "../../../[locale]/[...not-found].page";

/** An address the draft has no page for. */
export const routeMeta = previewMeta(live);

export { default } from "../../../[locale]/[...not-found].page";
