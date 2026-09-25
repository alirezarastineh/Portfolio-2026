import { previewMeta } from "../../../../admin/preview/preview-route";
import Home, { routeMeta as live } from "../../../[locale]/index.page";

/** The home page, from the draft. */
export const routeMeta = previewMeta(live);
export default Home;
