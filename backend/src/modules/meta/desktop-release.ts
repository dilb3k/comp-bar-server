import {
  pickAsset,
  resolveLatestRelease,
  type ReleaseAsset,
} from "./github-release";

/**
 * The desktop version and installer links the landing page advertises.
 *
 * The landing used to read GitHub's release feed straight from the browser.
 * That works until it doesn't: unauthenticated calls are capped at 60 per hour
 * *per visitor IP*, and once a visitor is over that cap GitHub answers 403 and
 * the page silently falls back to a version constant baked into its bundle —
 * so a freshly published release could stay invisible to a real user while
 * looking perfectly current to whoever tested it. Serving the lookup from here
 * turns one call per visitor into one call per ten minutes, from a single IP,
 * with a redirect-based second path for when even that IP is over the cap
 * (see github-release.ts — in production it always is).
 */
const REPO = "dilb3k/hisvex-desktop";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

const CACHE_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;

export type DesktopRelease = {
  latest: string;
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
const fallback = (): DesktopRelease => ({ latest: "", releasesUrl: RELEASES_PAGE });

const assetUrl = (version: string, file: string) =>
  `https://github.com/${REPO}/releases/download/v${version}/${file}`;

/**
 * Asset URLs, preferring the names the release actually published.
 *
 * When the version came from the redirect path there is no asset list, so the
 * URLs are rebuilt from electron-builder's naming convention — the same names
 * the release workflow produces (.github/workflows/release.yml).
 */
const build = (version: string, assets: ReleaseAsset[]): DesktopRelease => ({
  latest: version,
  windows:
    pickAsset(assets, (n) => n.startsWith("hisvex-setup") && n.endsWith(".exe")) ??
    assetUrl(version, `Hisvex-Setup-${version}.exe`),
  windowsPortable:
    pickAsset(assets, (n) => n.includes("portable") && n.endsWith(".exe")) ??
    assetUrl(version, `Hisvex-Portable-${version}.exe`),
  macArm:
    pickAsset(assets, (n) => n.includes("arm64") && n.endsWith(".dmg")) ??
    assetUrl(version, `Hisvex-${version}-arm64.dmg`),
  macIntel:
    pickAsset(assets, (n) => n.includes("x64") && n.endsWith(".dmg")) ??
    assetUrl(version, `Hisvex-${version}-x64.dmg`),
  linuxAppImage:
    pickAsset(assets, (n) => n.endsWith(".appimage")) ??
    assetUrl(version, `Hisvex-${version}.AppImage`),
  linuxDeb:
    pickAsset(assets, (n) => n.endsWith(".deb")) ??
    assetUrl(version, `hisvex-desktop_${version}_amd64.deb`),
  releasesUrl: RELEASES_PAGE,
});

export const getLatestDesktopRelease = async (): Promise<DesktopRelease> => {
  const ttl = cachedIsFallback ? FAILURE_TTL_MS : CACHE_TTL_MS;
  if (cached && Date.now() - cachedAt < ttl) return cached;

  // Collapse concurrent misses into one upstream request, so a burst of page
  // loads after a cache expiry does not spend the whole rate-limit budget.
  if (!inFlight) {
    inFlight = resolveLatestRelease(REPO)
      .then(({ tag, assets }) => (tag ? build(tag, assets) : fallback()))
      .catch(fallback)
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
