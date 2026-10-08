/**
 * Adds CSS to the page and returns a function that removes it.
 *
 * Uses a constructed stylesheet instead of a `<style>` element: YouTube Music
 * enforces a CSP and Trusted Types, which constructed stylesheets are exempt from.
 */
export function injectCss(css: string, doc: Document = document): () => void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  return () => {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((other) => other !== sheet);
  };
}
