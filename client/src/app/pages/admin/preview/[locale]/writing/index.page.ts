import { previewMeta } from "../../../../../admin/preview/preview-route";
import { routeMeta as live } from "../../../../[locale]/writing/index.page";

/** The writing index, from the draft — draft and scheduled posts included. */
export const routeMeta = previewMeta(live);

export { default } from "../../../../[locale]/writing/index.page";
