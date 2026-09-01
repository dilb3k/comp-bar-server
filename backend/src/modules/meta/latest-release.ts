import { env } from "../../config/env";
import { pickAsset, resolveLatestRelease } from "./github-release";

/**
 * The version the mobile app compares itself against on launch.
 *
 * This used to be two env vars on the host, which meant shipping an APK took
 * three coordinated edits (app.json, the landing page, and the Render
 * dashboard) and nothing failed loudly when one was missed — the backend
 * happily kept telling every phone that 1.0.3 was current long after it was
 * not. Reading the release feed instead makes publishing the release the
 * single act that ships an update.
 *
 * The lookup goes through github-release.ts, which tries the API and then a
 * plain github.com redirect. That second path is not a nicety: measured in
 * production, api.github.com answers 403 to this host every time (60
 * requests/hour, per IP, on a shared one), so the API-only version of this
 * silently served the env fallback — a phone was being told 1.1.0 with a
 * download link pointing at the releases page rather than an APK.
 */
const REPO = "dilb3k/hisvex-mobile";

const CACHE_TTL_MS = 10 * 60 * 1000;

// A failed lookup is cached too — otherwise every request retries a dead
// endpoint — but for far less time, because caching a failure for the full
// ten minutes is what made the first deploy on a cold container serve the
// fallback URL long after GitHub was reachable again.
const FAILURE_TTL_MS = 30 * 1000;


type Release = { latest: string; downloadUrl: string };

let cached: Release | null = null;
let cachedAt = 0;
let cachedIsFallback = false;
let inFlight: Promise<Release> | null = null;

const fallback = (): Release => ({
  latest: env.MOBILE_LATEST_VERSION,
  downloadUrl: env.MOBILE_DOWNLOAD_URL,
});

const fetchLatest = async (): Promise<Release> => {
  const { tag, assets } = await resolveLatestRelease(REPO);
  if (!tag) return fallback();

  // Prefer the APK the release actually published; when the version came from
  // the redirect path there is no asset list, so rebuild the URL from the
  // naming convention the release uses.
  const apk =
    pickAsset(assets, (n) => n.endsWith(".apk")) ??
    `https://github.com/${REPO}/releases/download/v${tag}/Hisvex-${tag}.apk`;

  return { latest: tag, downloadUrl: apk };
};

export const getLatestMobileRelease = async (): Promise<Release> => {
  const ttl = cachedIsFallback ? FAILURE_TTL_MS : CACHE_TTL_MS;
  if (cached && Date.now() - cachedAt < ttl) return cached;

  // Collapse concurrent misses into one upstream request, so a burst of app
  // launches after a cache expiry does not spend the whole rate-limit budget.
  if (!inFlight) {
    const fallbackUrl = fallback().downloadUrl;
    inFlight = fetchLatest()
      .then((release) => {
        cached = release;
        cachedAt = Date.now();
        cachedIsFallback = release.downloadUrl === fallbackUrl;
        return release;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
};
