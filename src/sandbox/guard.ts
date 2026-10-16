// Closes the ways out of a plugin's frame that its content security policy
// leaves open in Chromium:
// - `<link rel="preconnect">`, `dns-prefetch` and `prerender` reach any host,
//   whatever `default-src` says;
// - WebRTC contacts the STUN and TURN servers it is given, which no policy covers;
// - a nested frame would bring fresh, unguarded copies of all of this.
// It runs before the plugin's code, which then only sees the closed versions:
// what is replaced here is neither writable nor configurable.
//
// HTML from strings (`innerHTML` and its relatives) passes through the
// Trusted Types default policy below, which the frame's policy enforces. Where
// the browser has no Trusted Types, as WebKitGTK on Linux, only the DOM
// methods are guarded.

const XHTML = "http://www.w3.org/1999/xhtml";
/** Elements a plugin cannot have: each could contact a host or bring a fresh window. */
const BLOCKED = ["meta", "iframe", "frame", "object", "embed", "portal", "fencedframe"];
/** A `<link>` may only load a stylesheet, which the policy limits to the plugin's folder. */
const LINK_REL = "stylesheet";
/** The names the frame's policy allows for Trusted Types policies, both taken here. */
export const POLICY_NAMES = ["default", "ytmd-sanitizer"] as const;

const isBlockedName = (name: unknown): boolean => BLOCKED.includes(String(name).toLowerCase());
const allowedRel = (value: unknown): boolean => String(value).trim().toLowerCase() === LINK_REL;

function refuse(what: string): never {
  throw new DOMException(`${what} is not available to plugins`, "NotSupportedError");
}

/** Replaces a method or accessor for good. */
function lock(target: object, name: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, name, { ...descriptor, configurable: false, ...("value" in descriptor ? { writable: false } : {}) });
}

function getter<T>(target: object, name: string): (this: unknown) => T {
  const get = Object.getOwnPropertyDescriptor(target, name)?.get;
  if (!get) throw new Error(`no getter ${name}`);
  return get as (this: unknown) => T;
}

export function installGuard(): void {
  // Read through the original getters, which a plugin cannot redefine on an element.
  const localName = getter<string>(Element.prototype, "localName");
  const namespaceURI = getter<string | null>(Element.prototype, "namespaceURI");
  const attrLocalName = getter<string>(Attr.prototype, "localName");
  const attrNamespace = getter<string | null>(Attr.prototype, "namespaceURI");
  const ownerElement = getter<Element | null>(Attr.prototype, "ownerElement");
  const nodeType = getter<number>(Node.prototype, "nodeType");

  // Not `instanceof`: an element whose prototype was swapped is still an element.
  const isLink = (element: unknown): boolean =>
    typeof element === "object" &&
    element !== null &&
    safe(() => localName.call(element) === "link" && namespaceURI.call(element) === XHTML);
  const isRelAttr = (attr: unknown): boolean =>
    safe(() => attrLocalName.call(attr) === "rel" && attrNamespace.call(attr) === null);
  const checkRel = (value: unknown): void => {
    if (!allowedRel(value)) refuse(`<link rel="${String(value)}">`);
  };

  removeWebRtc();
  for (const name of ["XSLTProcessor", "Sanitizer"]) delete (globalThis as Record<string, unknown>)[name];
  for (const target of [Element.prototype, ShadowRoot.prototype]) {
    // `setHTML` parses without Trusted Types.
    if ("setHTML" in target) lock(target, "setHTML", { value: () => refuse("setHTML") });
  }
  if ("parseHTML" in Document) lock(Document, "parseHTML", { value: () => refuse("Document.parseHTML") });

  const createElement = Document.prototype.createElement;
  lock(Document.prototype, "createElement", {
    value: function (this: Document, name: string, options?: ElementCreationOptions) {
      if (isBlockedName(name)) refuse(`<${name}>`);
      const element = createElement.call(this, name, options);
      if (localName.call(element) === "link") element.setAttribute("rel", LINK_REL);
      return element;
    },
  });
  const createElementNS = Document.prototype.createElementNS;
  lock(Document.prototype, "createElementNS", {
    value: function (this: Document, namespace: string | null, name: string, options?: ElementCreationOptions) {
      const element = createElementNS.call(this, namespace, name, options);
      if (namespaceURI.call(element) === XHTML) {
        if (isBlockedName(localName.call(element))) refuse(`<${name}>`);
        if (localName.call(element) === "link") element.setAttribute("rel", LINK_REL);
      }
      return element;
    },
  });

  // Every way to change an attribute, checked for `rel` on a `<link>`.
  const setAttribute = Element.prototype.setAttribute;
  lock(Element.prototype, "setAttribute", {
    value: function (this: Element, name: string, value: string) {
      if (isLink(this) && String(name).toLowerCase() === "rel") checkRel(value);
      return setAttribute.call(this, name, value);
    },
  });
  const setAttributeNS = Element.prototype.setAttributeNS;
  lock(Element.prototype, "setAttributeNS", {
    value: function (this: Element, namespace: string | null, name: string, value: string) {
      if (isLink(this) && (namespace === null || namespace === "") && String(name).toLowerCase() === "rel") checkRel(value);
      return setAttributeNS.call(this, namespace, name, value);
    },
  });
  for (const name of ["setAttributeNode", "setAttributeNodeNS"] as const) {
    const original = Element.prototype[name];
    lock(Element.prototype, name, {
      value: function (this: Element, attr: Attr) {
        if (isLink(this) && isRelAttr(attr)) checkRel(attr.value);
        return original.call(this, attr);
      },
    });
  }
  // A NamedNodeMap does not tell its element; `attributes` records it.
  const mapOwners = new WeakMap<NamedNodeMap, Element>();
  const attributes = getter<NamedNodeMap>(Element.prototype, "attributes");
  lock(Element.prototype, "attributes", {
    get(this: Element) {
      const map = attributes.call(this);
      mapOwners.set(map, this);
      return map;
    },
  });
  for (const name of ["setNamedItem", "setNamedItemNS"] as const) {
    const original = NamedNodeMap.prototype[name];
    lock(NamedNodeMap.prototype, name, {
      value: function (this: NamedNodeMap, attr: Attr) {
        if (isLink(mapOwners.get(this)) && isRelAttr(attr)) checkRel(attr.value);
        return original.call(this, attr);
      },
    });
  }
  // An attribute already on an element changes through its node, too.
  const guardAttrSetter = (target: object, name: string): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    const set = descriptor?.set;
    if (!descriptor || !set) return;
    lock(target, name, {
      get: descriptor.get,
      set(this: Node, value: unknown) {
        if (safe(() => nodeType.call(this) === Node.ATTRIBUTE_NODE) && isRelAttr(this) && isLink(ownerElement.call(this))) {
          checkRel(value);
        }
        set.call(this, value);
      },
    });
  };
  guardAttrSetter(Attr.prototype, "value");
  guardAttrSetter(Node.prototype, "nodeValue");
  guardAttrSetter(Node.prototype, "textContent");

  // `link.rel` and `link.relList`.
  const linkPrototype = Object.getPrototypeOf(createElement.call(document, "link")) as object;
  const rel = Object.getOwnPropertyDescriptor(linkPrototype, "rel");
  if (rel?.set) {
    const set = rel.set;
    lock(linkPrototype, "rel", {
      get: rel.get,
      set(this: Element, value: unknown) {
        checkRel(value);
        set.call(this, value);
      },
    });
  }
  const relLists = new WeakSet<DOMTokenList>();
  const relList = getter<DOMTokenList>(linkPrototype, "relList");
  lock(linkPrototype, "relList", {
    get(this: Element) {
      const list = relList.call(this);
      relLists.add(list);
      return list;
    },
    set(this: Element, value: unknown) {
      checkRel(value);
      relList.call(this).value = String(value);
    },
  });
  const tokenList = DOMTokenList.prototype;
  const { add, toggle, replace } = tokenList;
  lock(tokenList, "add", {
    value: function (this: DOMTokenList, ...tokens: string[]) {
      if (relLists.has(this)) tokens.forEach(checkRel);
      return add.apply(this, tokens);
    },
  });
  lock(tokenList, "toggle", {
    value: function (this: DOMTokenList, token: string, force?: boolean) {
      if (relLists.has(this)) checkRel(token);
      return force === undefined ? toggle.call(this, token) : toggle.call(this, token, force);
    },
  });
  lock(tokenList, "replace", {
    value: function (this: DOMTokenList, token: string, newToken: string) {
      if (relLists.has(this)) checkRel(newToken);
      return replace.call(this, token, newToken);
    },
  });
  const tokenValue = Object.getOwnPropertyDescriptor(tokenList, "value");
  if (tokenValue?.set) {
    const set = tokenValue.set;
    lock(tokenList, "value", {
      get: tokenValue.get,
      set(this: DOMTokenList, value: unknown) {
        if (relLists.has(this)) checkRel(value);
        set.call(this, value);
      },
    });
  }

  // Without these constructors, no element of the kinds above can be made as
  // a custom element either.
  for (const name of [
    "HTMLLinkElement",
    "HTMLMetaElement",
    "HTMLIFrameElement",
    "HTMLFrameElement",
    "HTMLObjectElement",
    "HTMLEmbedElement",
    "HTMLPortalElement",
    "HTMLFencedFrameElement",
  ]) {
    delete (globalThis as Record<string, unknown>)[name];
  }

  installSanitizer(createElement);
}

function removeWebRtc(): void {
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (/^(webkit)?RTC/.test(name)) delete (globalThis as Record<string, unknown>)[name];
  }
}

/** Parses HTML from strings as the DOM methods would allow it. */
function installSanitizer(createElement: Document["createElement"]): void {
  const types = (globalThis as { trustedTypes?: TrustedTypePolicyFactoryLike }).trustedTypes;
  if (!types) return;
  const raw = types.createPolicy(POLICY_NAMES[1], { createHTML: (html: string) => html });
  const parse = (html: string): HTMLTemplateElement => {
    const template = createElement.call(document, "template") as HTMLTemplateElement;
    (template as unknown as { innerHTML: unknown }).innerHTML = raw.createHTML(html);
    return template;
  };
  types.createPolicy(POLICY_NAMES[0], {
    createHTML: (html: string) => {
      const template = parse(html);
      clean(template.content);
      const result = template.innerHTML;
      // Parsed again, the result must come out clean as it is; if not, give nothing.
      return clean(parse(result).content) === 0 ? result : "";
    },
    createScript: (script: string) => script,
    createScriptURL: (url: string) => url,
  });
}

/** Removes what a plugin cannot have from parsed HTML. Returns how much it removed. */
export function clean(fragment: DocumentFragment | Element): number {
  let removed = 0;
  for (const element of fragment.querySelectorAll(BLOCKED.join(","))) {
    element.remove();
    removed++;
  }
  for (const link of fragment.querySelectorAll("link")) {
    if (!allowedRel(link.getAttribute("rel"))) {
      link.remove();
      removed++;
    }
  }
  for (const template of fragment.querySelectorAll("template")) removed += clean(template.content);
  return removed;
}

function safe(test: () => boolean): boolean {
  try {
    return test();
  } catch {
    return false;
  }
}

interface TrustedTypePolicyFactoryLike {
  createPolicy(
    name: string,
    rules: { createHTML?(input: string): string; createScript?(input: string): string; createScriptURL?(input: string): string },
  ): { createHTML(input: string): unknown };
}
