import { defineEventHandler, setResponseHeader } from "h3";

import { getAskQuestions } from "../../../utils/ask-questions";

/**
 * The admin's suggested questions and the assistant's state, for the hero's stage. Through this
 * server, and read during the server render, so they are in the first HTML: nothing swaps after the
 * paint, and the transfer cache spares the browser the request.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=60");
  return getAskQuestions();
});
