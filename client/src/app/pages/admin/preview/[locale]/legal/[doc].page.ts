import { previewMeta } from "../../../../../admin/preview/preview-route";
import { routeMeta as live } from "../../../../[locale]/legal/[doc].page";

/** The imprint or privacy page, from the draft. */
export const routeMeta = previewMeta(live);

export { default } from "../../../../[locale]/legal/[doc].page";
