import { describe, expect, it } from "vitest";

import { htmlToText, mediaImages } from "../../content/sanitize.js";
import type { CorpusDocument, CorpusImage } from "./build.js";
import { describeImages } from "./index.js";

/** Plan phase 17: the admin's image descriptions follow their pictures' markers. */

const doc = (text: string, images: CorpusImage[], locale: "en" | "de" = "en"): CorpusDocument => ({
  id: `project:x@${locale}`,
  kind: "project",
  locale,
  title: "X",
  url: "/x",
  text,
  images,
});

describe("image descriptions in the corpus", () => {
  it("follow their own picture's marker, two pictures with one alt told apart by order", () => {
    const d = doc(
      "Cover: [image: Diagram]\nBody\n[image: Diagram]\nGallery: A caption [image: Photo]",
      [
        { file: "a.png", alt: "Diagram" },
        { file: "b.png", alt: "Diagram" },
        { file: "c.png", alt: "Photo" },
      ],
    );
    const described = describeImages(
      d,
      new Map([
        ["b.png", { en: "B shows [two] boxes" }],
        ["c.png", { de: "Ein Foto" }],
      ]),
    );
    expect(described.text).toBe(
      "Cover: [image: Diagram]\nBody\n[image: Diagram]\n[image description: B shows (two) boxes]\nGallery: A caption [image: Photo]\n[image description: Ein Foto]",
    );
  });

  it("follow a picture whose alt reads like a tag, as the corpus text shows it", () => {
    const html = '<img src="/media/t.png" alt="The &lt;AskTerminal&gt; component">';
    const [picture] = mediaImages(html);
    const d = doc(htmlToText(html, { images: true }), [{ file: "t.png", alt: picture!.alt }]);
    expect(describeImages(d, new Map([["t.png", { en: "Input → agent" }]])).text).toBe(
      "[image: The <AskTerminal> component]\n[image description: Input → agent]",
    );
  });

  it("read the document's own language first, then the other", () => {
    const images = [{ file: "a.png", alt: "Diagram" }];
    const both = new Map([["a.png", { en: "In English", de: "Auf Deutsch" }]]);
    expect(describeImages(doc("[image: Diagram]", images, "de"), both).text).toBe(
      "[image: Diagram]\n[image description: Auf Deutsch]",
    );
    const english = new Map([["a.png", { en: "In English" }]]);
    expect(describeImages(doc("[image: Diagram]", images, "de"), english).text).toBe(
      "[image: Diagram]\n[image description: In English]",
    );
  });

  it("leave a document alone without pictures, descriptions or a marker to follow", () => {
    const plain = doc("No pictures here.", []);
    const descriptions = new Map([["a.png", { en: "A" }]]);
    expect(describeImages(plain, descriptions)).toBe(plain);
    const pictured = doc("[image: Diagram]", [{ file: "a.png", alt: "Diagram" }]);
    expect(describeImages(pictured, new Map())).toBe(pictured);
    const lost = doc("The marker is gone.", [{ file: "a.png", alt: "Diagram" }]);
    expect(describeImages(lost, descriptions)).toBe(lost);
  });
});
