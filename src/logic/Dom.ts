export const TOP_BAR_SELECTORS = [
  ".main-topBar-topbarContentWrapper",
  ".main-topBar-topbarContent",
  "[data-testid='topbar-content-wrapper']",
  ".main-topBar-container",
  ".Root__globalNav .main-topBar-topbarContent",
  ".Root__top-bar header"
] as const;

export const MAIN_VIEW_SCROLL_SELECTORS = [
  ".os-viewport",
  "#main .main-view-container__scroll-node",
  ".main-view-container__scroll-node",
  "[data-overlayscrollbars-viewport]",
  ".Root__main-view .os-viewport",
  ".main-view-container [data-overlayscrollbars-viewport]"
] as const;

export function querySelectorFirst<T extends Element = Element>(selectors: readonly string[], root: ParentNode = document): T | null {
  for (const selector of selectors) {
    try {
      const element = root.querySelector<T>(selector);
      if (element) return element;
    } catch (error) {
      console.warn(`Marketplace: invalid selector "${selector}"`, error);
    }
  }
  return null;
}

type WaitOptions = {
  timeout?: number;
  signal?: AbortSignal;
  root?: Node;
};

export function waitForElement<T extends Element = Element>(selectors: readonly string[], options: WaitOptions = {}): Promise<T | null> {
  const { timeout = 15000, signal, root = document.documentElement } = options;

  const immediate = querySelectorFirst<T>(selectors);
  if (immediate) return Promise.resolve(immediate);
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise<T | null>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (element: T | null) => {
      observer.disconnect();
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      resolve(element);
    };

    const onAbort = () => finish(null);

    const observer = new MutationObserver(() => {
      const element = querySelectorFirst<T>(selectors);
      if (element) finish(element);
    });

    signal?.addEventListener("abort", onAbort, { once: true });
    observer.observe(root, { childList: true, subtree: true });

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        console.warn(`Marketplace: timed out waiting for ${selectors.join(", ")}`);
        finish(null);
      }, timeout);
    }
  });
}

type AttachOptions = {
  timeout?: number;
  onMissing?: () => void;
};

export function attachAndKeepMounted(node: HTMLElement, selectors: readonly string[], options: AttachOptions = {}): () => void {
  const { timeout = 15000, onMissing } = options;

  const controller = new AbortController();
  let observer: MutationObserver | null = null;
  let frame: number | null = null;
  let disposed = false;

  const detachObserver = () => {
    observer?.disconnect();
    observer = null;
  };

  const attach = (container: Element) => {
    if (disposed || node.parentElement === container) return;
    container.appendChild(node);
  };

  const watch = (container: Element) => {
    detachObserver();

    const observed = container.parentElement ?? container;
    observer = new MutationObserver(() => {
      if (disposed || node.isConnected) return;
      if (frame !== null) return;

      frame = requestAnimationFrame(() => {
        frame = null;
        if (disposed || node.isConnected) return;

        const next = querySelectorFirst(selectors);
        if (!next) return;

        attach(next);
        if (next !== container) watch(next);
      });
    });

    observer.observe(observed, { childList: true, subtree: true });
  };

  void waitForElement(selectors, { timeout, signal: controller.signal }).then((container) => {
    if (disposed) return;

    if (!container) {
      onMissing?.();
      return;
    }

    attach(container);
    watch(container);
  });

  return () => {
    disposed = true;
    controller.abort();
    detachObserver();
    if (frame !== null) cancelAnimationFrame(frame);
    node.remove();
  };
}
