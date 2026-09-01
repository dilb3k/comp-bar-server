/**
 * The desktop version and installer links the landing page advertises.
 *
 * The landing used to read GitHub's release feed straight from the browser.
 * That works until it doesn't: unauthenticated calls are capped at 60 per hour
 * *per visitor IP*, and once a visitor is over that cap GitHub answers 403 and
 * the page silently falls back to a version constant baked into its bundle —
 * so a freshly published release could stay invisible to a real user while
 * looking perfectly current to whoever tested it. Serving the lookup from here
 * turns one call per visitor into one call per ten minutes, from a single IP.
 *
 * Assets are returned by name rather than reconstructed from the version, so a
 * renamed or missing installer shows up as a missing link instead of a link
 * that 404s.
 */
const RELEASES_API =
  "https://api.github.com/repos/dilb3k/hisvex-desktop/releases/latest";

const RELEASES_PAGE = "https://github.com/dilb3k/hisvex-desktop/releases/latest";

const CACHE_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export type DesktopRelease = {
  latest: string;
  /** Absent when that platform's installer is not attached to the release. */
  windows?: string;
  windowsPortable?: string;
  macArm?: string;
  macIntel?: string;
  linuxAppImage?: string;
  linuxDeb?: string;
  /** Always present — where to send someone when no direct asset matched. */
  releasesUrl: string;
};

let cached: DesktopRelease | null = null;
let cachedAt = 0;
let cachedIsFallback = false;
let inFlight: Promise<DesktopRelease> | null = null;

// Deliberately version-less: a fallback that names a version would be the
// exact stale-number problem this module exists to remove. GitHub's /latest
// page always redirects to whatever is actually current.
const fallback = (): DesktopRelease => ({
  latest: "",
  releasesUrl: RELEASES_PAGE,
});

const pick = (
  assets: Array<{ name?: string; browser_download_url?: string }>,
  match: (name: string) => boolean,
): string | undefined =>
  assets.find((a) => a.name && match(a.name.toLowerCase()))?.browser_download_url;

const fetchLatest = async (): Promise<DesktopRelease> => {
  try {
    const res = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "hisvex-backend",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return fallback();

    const body = (await res.json()) as {
      tag_name?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const latest = String(body.tag_name ?? "").replace(/^v/i, "").trim();
    const assets = body.assets ?? [];
    if (!latest || assets.length === 0) return fallback();

    return {
      latest,
      windows: pick(assets, (n) => n.startsWith("hisvex-setup") && n.endsWith(".exe")),
      windowsPortable: pick(assets, (n) => n.includes("portable") && n.endsWith(".exe")),
      macArm: pick(assets, (n) => n.includes("arm64") && n.endsWith(".dmg")),
      macIntel: pick(assets, (n) => n.includes("x64") && n.endsWith(".dmg")),
      linuxAppImage: pick(assets, (n) => n.endsWith(".appimage")),
      linuxDeb: pick(assets, (n) => n.endsWith(".deb")),
      releasesUrl: RELEASES_PAGE,
    };
  } catch {
    return fallback();
  }
};

export const getLatestDesktopRelease = async (): Promise<DesktopRelease> => {
  const ttl = cachedIsFallback ? FAILURE_TTL_MS : CACHE_TTL_MS;
  if (cached && Date.now() - cachedAt < ttl) return cached;

  // Collapse concurrent misses into one upstream request, so a burst of page
  // loads after a cache expiry does not spend the whole rate-limit budget.
  if (!inFlight) {
    inFlight = fetchLatest()
      .then((release) => {
        cached = release;
        cachedAt = Date.now();
        cachedIsFallback = release.latest === "";
        return release;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
};
