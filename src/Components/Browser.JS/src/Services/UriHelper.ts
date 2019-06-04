import '@dotnet/jsinterop';

let hasRegisteredNavigationInterception = false;
let hasRegisteredNavigationEventListeners = false;

// Will be initialized once someone registers
let notifyLocationChangedCallback: { assemblyName: string; functionName: string } | null = null;

// These are the functions we're making available for invocation from .NET
export const internalFunctions = {
  listenForNavigationEvents,
  enableNavigationInterception,
  navigateTo,
  getBaseURI: () => document.baseURI,
  getLocationHref: () => location.href,
};

function listenForNavigationEvents(assemblyName: string, functionName: string) {
  if (hasRegisteredNavigationEventListeners) {
    return;
  }

  notifyLocationChangedCallback = { assemblyName, functionName };

  hasRegisteredNavigationEventListeners = true;
  window.addEventListener('popstate', () => notifyLocationChanged(false));
}

function enableNavigationInterception() {
  if (hasRegisteredNavigationInterception) {
    return;
  }

  hasRegisteredNavigationInterception = true;

  document.addEventListener('click', event => {
    if (event.button !== 0 || eventHasSpecialKey(event)) {
      // Don't stop ctrl/meta-click (etc) from opening links in new tabs/windows
      return;
    }

    // Intercept clicks on all <a> elements where the href is within the <base href> URI space
    // We must explicitly check if it has an 'href' attribute, because if it doesn't, the result might be null or an empty string depending on the browser
    const anchorTarget = findClosestAncestor(event.target as Element | null, 'A') as HTMLAnchorElement;
    const hrefAttributeName = 'href';
    if (anchorTarget && anchorTarget.hasAttribute(hrefAttributeName)) {
      const targetAttributeValue = anchorTarget.getAttribute('target');
      const opensInSameFrame = !targetAttributeValue || targetAttributeValue === '_self';
      if (!opensInSameFrame) {
        return;
      }

      const href = anchorTarget.getAttribute(hrefAttributeName)!;
      const absoluteHref = toAbsoluteUri(href);

      if (isWithinBaseUriSpace(absoluteHref)) {
        event.preventDefault();
        performInternalNavigation(absoluteHref, true);
      }
    }
  });
}

export function navigateTo(uri: string, forceLoad: boolean) {
  const absoluteUri = toAbsoluteUri(uri);

  if (!forceLoad && isWithinBaseUriSpace(absoluteUri)) {
    // It's an internal URL, so do client-side navigation
    performInternalNavigation(absoluteUri, false);
  } else if (forceLoad && location.href === uri) {
    // Force-loading the same URL you're already on requires special handling to avoid
    // triggering browser-specific behavior issues.
    const temporaryUri = uri + '?';
    history.replaceState(null, '', temporaryUri);
    window.location.replace(uri);
  } else {
    // It's either an external URL, or forceLoad is requested, so do a full page load
    location.href = uri;
  }
}

function performInternalNavigation(absoluteInternalHref: string, interceptedLink: boolean) {
  history.pushState(null, /* ignored title */ '', absoluteInternalHref);
  notifyLocationChanged(interceptedLink);
}

async function notifyLocationChanged(interceptedLink: boolean) {
  if (notifyLocationChangedCallback) {
    await DotNet.invokeMethodAsync(
      notifyLocationChangedCallback.assemblyName,
      notifyLocationChangedCallback.functionName,
      location.href,
      interceptedLink
    );
  }
}

let testAnchor: HTMLAnchorElement;
function toAbsoluteUri(relativeUri: string) {
  testAnchor = testAnchor || document.createElement('a');
  testAnchor.href = relativeUri;
  return testAnchor.href;
}

function findClosestAncestor(element: Element | null, tagName: string) {
  return !element
    ? null
    : element.tagName === tagName
      ? element
      : findClosestAncestor(element.parentElement, tagName);
}

function isWithinBaseUriSpace(href: string) {
  const baseUriWithTrailingSlash = toBaseUriWithTrailingSlash(document.baseURI!); // TODO: Might baseURI really be null?
  return href.startsWith(baseUriWithTrailingSlash);
}

function toBaseUriWithTrailingSlash(baseUri: string) {
  return baseUri.substr(0, baseUri.lastIndexOf('/') + 1);
}

function eventHasSpecialKey(event: MouseEvent) {
  return event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
}
