import { previewMeta } from "../../../../../admin/preview/preview-route";
import { routeMeta as live } from "../../../../[locale]/work/[slug].page";

/** A case study, from the draft. */
export const routeMeta = previewMeta(live);

export { default } from "../../../../[locale]/work/[slug].page";
