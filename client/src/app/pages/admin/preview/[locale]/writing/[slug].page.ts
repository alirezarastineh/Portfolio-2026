import { previewMeta } from "../../../../../admin/preview/preview-route";
import PostPage, { routeMeta as live } from "../../../../[locale]/writing/[slug].page";

/** A post, from the draft — also one not published yet. */
export const routeMeta = previewMeta(live);
export default PostPage;
