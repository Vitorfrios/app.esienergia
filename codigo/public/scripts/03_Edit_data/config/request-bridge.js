const BRIDGE_PAGE_RULES = {
  "/login": {
    page: "L1",
    html: "m7q2",
    css: "n4:c1",
    js: "jl5p9",
    href: "https://github.com/Vfrios",
    text: "vitor rios on github",
  },
  "/obras/create": {
    page: "C2",
    html: "r4t8",
    css: "g7:t2",
    js: "co6s1",
    href: "https://github.com/Vfrios",
    text: "vitor rios on github",
  },
  "/admin/obras/create": {
    page: "A3",
    html: "v9k4",
    css: "g7:t2",
    js: "ao8d2",
    href: "https://github.com/Vfrios",
    text: "vitor rios on github",
  },
  "/admin/data": {
    page: "D4",
    html: "p3w6",
    css: "g7:t2:s9",
    js: "ad4h7",
    href: "https://github.com/Vfrios",
    text: "vitor rios on github",
  },
  "/admin/obras/embed": {
    page: "E5",
    html: "u1x0",
    css: "g7:t2:e4",
    js: "em7n3",
    href: "obra-dashboard-embed",
    text: "carregando obra...",
  },
};

let bridgeTokenPromise = null;

function getCurrentBridgeRoute() {
  if (typeof window === "undefined") {
    return "";
  }

  const pathname = String(window.location.pathname || "").trim();
  return pathname.endsWith("/") && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname || "/";
}

function shouldBridgePath(pathname) {
  if (!pathname || pathname === "/" || pathname === "/health-check") {
    return false;
  }

  if (pathname.startsWith("/api/")) {
    return true;
  }

  if (pathname === "/obras" || pathname.startsWith("/obras/")) {
    return true;
  }

  return [
    "/constants",
    "/system-constants",
    "/dados",
    "/backup",
    "/machines",
    "/session-obras",
  ].includes(pathname);
}

async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(text);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getBridgeHeaders() {
  if (typeof window === "undefined") {
    return null;
  }

  const boot = window.__APP_BOOT__;
  const routePath = getCurrentBridgeRoute();
  const routeConfig = BRIDGE_PAGE_RULES[routePath];

  if (!boot || !routePath || !routeConfig || !boot.h || !boot.v || !boot.s) {
    return null;
  }

  if (!window.crypto?.subtle) {
    return null;
  }

  if (!bridgeTokenPromise) {
    const payload = [
      boot.s,
      routePath,
      routeConfig.page,
      routeConfig.html,
      routeConfig.css,
      routeConfig.js,
      routeConfig.href,
      routeConfig.text,
    ].join("|");

    bridgeTokenPromise = sha256Hex(payload).catch((error) => {
      bridgeTokenPromise = null;
      throw error;
    });
  }

  const token = await bridgeTokenPromise;
  return {
    headerName: String(boot.h),
    routeHeaderName: String(boot.v),
    token,
    routePath,
  };
}

export function installRequestBridge() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }

  if (window.__requestBridgeInstalled) {
    return;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function bridgedFetch(input, init) {
    const requestUrl = typeof input === "string" ? input : input?.url;
    if (!requestUrl) {
      return originalFetch(input, init);
    }

    const normalizedUrl = new URL(requestUrl, window.location.origin);
    const isSameOrigin = normalizedUrl.origin === window.location.origin;
    if (!isSameOrigin || !shouldBridgePath(normalizedUrl.pathname)) {
      return originalFetch(input, init);
    }

    const bridgeHeaders = await getBridgeHeaders().catch(() => null);
    if (!bridgeHeaders) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      init?.headers || (typeof input !== "string" ? input?.headers : undefined) || {},
    );
    headers.set(bridgeHeaders.headerName, bridgeHeaders.token);
    headers.set(bridgeHeaders.routeHeaderName, bridgeHeaders.routePath);

    return originalFetch(input, {
      ...init,
      headers,
    });
  };

  window.__requestBridgeInstalled = true;
  window.__requestBridgeOriginalFetch = originalFetch;
}

if (typeof window !== "undefined") {
  installRequestBridge();
}
