/**
 * The smallest virtual DOM that still lets `view()` stay a pure function.
 *
 * A framework would cost more gzipped bytes than the whole console (AC-5,
 * 40 KB budget), and `innerHTML` re-rendering would drop the range input
 * mid-drag and the message field's caret. So: `view()` builds plain objects,
 * `createRenderer` diffs them positionally against the previous tree and
 * mutates only what changed, and every interaction is a `data-act` attribute
 * read by one delegated listener in `main.ts`. No handlers live in the tree,
 * which is what keeps `view()` testable under jsdom.
 */

export type PropValue = string | number | boolean | null | undefined;
export type Props = Readonly<Record<string, PropValue>>;
export type VNodeChild = VNode | string;

export interface VNode {
  readonly tag: string;
  readonly props: Props;
  readonly children: readonly VNodeChild[];
}

/** Props applied as DOM properties rather than attributes. Setting the
 * attribute on a live input only changes its *default* value, so a controlled
 * text field or slider would never update after first paint. */
const DOM_PROPERTIES = new Set(['value']);

export function h(
  tag: string,
  props: Props = {},
  children: readonly VNodeChild[] = [],
): VNode {
  return { tag, props, children };
}

function setProp(element: Element, key: string, value: PropValue): void {
  if (DOM_PROPERTIES.has(key)) {
    const target = element as unknown as Record<string, unknown>;
    const next = value === null || value === undefined ? '' : String(value);
    if (target[key] !== next) {
      target[key] = next;
    }
    return;
  }

  if (value === false || value === null || value === undefined) {
    element.removeAttribute(key);
    return;
  }

  element.setAttribute(key, value === true ? '' : String(value));
}

function removeProp(element: Element, key: string): void {
  if (DOM_PROPERTIES.has(key)) {
    (element as unknown as Record<string, unknown>)[key] = '';
    return;
  }

  element.removeAttribute(key);
}

function patchProps(element: Element, previous: Props, next: Props): void {
  for (const key of Object.keys(next)) {
    if (previous[key] !== next[key] || DOM_PROPERTIES.has(key)) {
      setProp(element, key, next[key]);
    }
  }

  for (const key of Object.keys(previous)) {
    if (!(key in next)) {
      removeProp(element, key);
    }
  }
}

export function createNode(child: VNodeChild): Node {
  if (typeof child === 'string') {
    return document.createTextNode(child);
  }

  const element = document.createElement(child.tag);
  for (const key of Object.keys(child.props)) {
    setProp(element, key, child.props[key]);
  }
  for (const grandchild of child.children) {
    element.appendChild(createNode(grandchild));
  }

  return element;
}

function patchNode(
  parent: Node,
  node: Node,
  previous: VNodeChild,
  next: VNodeChild,
): void {
  if (typeof previous === 'string' || typeof next === 'string') {
    if (typeof previous === 'string' && typeof next === 'string') {
      if (previous !== next) {
        node.nodeValue = next;
      }
      return;
    }

    parent.replaceChild(createNode(next), node);
    return;
  }

  if (previous.tag !== next.tag || node.nodeType !== 1) {
    parent.replaceChild(createNode(next), node);
    return;
  }

  const element = node as Element;
  patchProps(element, previous.props, next.props);
  patchChildren(element, previous.children, next.children);
}

function patchChildren(
  parent: Node,
  previous: readonly VNodeChild[],
  next: readonly VNodeChild[],
): void {
  for (let index = 0; index < next.length; index += 1) {
    const existing = parent.childNodes[index];
    if (existing === undefined) {
      parent.appendChild(createNode(next[index]!));
      continue;
    }

    patchNode(parent, existing, previous[index] ?? '', next[index]!);
  }

  while (parent.childNodes.length > next.length) {
    parent.removeChild(parent.lastChild!);
  }
}

/**
 * Mounts into `root` and returns a render function. The first call builds the
 * tree; later calls diff against what was rendered before.
 */
export function createRenderer(root: Element): (tree: VNode) => void {
  let previous: VNode | undefined;

  return (tree: VNode): void => {
    if (previous === undefined || root.childNodes.length === 0) {
      root.replaceChildren(createNode(tree));
    } else {
      patchNode(root, root.childNodes[0]!, previous, tree);
    }

    previous = tree;
  };
}
