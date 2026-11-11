/**
 * Svelte action: move the node to <body>. Every `.qj-page > *` is its own stacking context (z-index 1), so an overlay
 * rendered inside a card would sit under later cards, the sticky Seal bar and the tab bar. At body level it's above all.
 */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
}
