import {
  defineEventHandler,
  getRouterParam,
  sendRedirect,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import type { AppContent } from "../../../app/content/schema";
import { getContent, isLocale } from "../../utils/content-upstream";

/**
 * `/en/resume.pdf`: a stable address for this language's CV. Redirects to the
 * uploaded file (`/media/<uuid>.pdf`), which the API serves as
 * `Alireza-Rastineh-CV-en.pdf`. 404 while no CV is set.
 */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, "locale");
  if (!isLocale(locale)) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  const { payload } = await getContent(locale);
  const href = (payload as AppContent).identity?.resume?.href;
  // Only ever to our own media route: the payload is validated, but a
  // redirect elsewhere would make this an open redirect.
  if (!href || !/^\/media\/[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(href)) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  // Short: a new CV is a new file, and this address must follow it quickly.
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=60");
  return sendRedirect(event, href, 302);
});
