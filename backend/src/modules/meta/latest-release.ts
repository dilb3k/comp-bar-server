import { env } from "../../config/env";

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
 * The env vars remain as the fallback: if GitHub is unreachable or rate-limits
 * us (60 requests/hour for unauthenticated callers, hence the cache), the
 * endpoint still answers with something valid rather than failing.
 */
const RELEASES_API =
  "https://api.github.com/repos/dilb3k/hisvex-mobile/releases/latest";

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

type Release = { latest: string; downloadUrl: string };

let cached: Release | null = null;
let cachedAt = 0;
let inFlight: Promise<Release> | null = null;

const fallback = (): Release => ({
  latest: env.MOBILE_LATEST_VERSION,
  downloadUrl: env.MOBILE_DOWNLOAD_URL,
});

const fetchLatest = async (): Promise<Release> => {
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

    const tag = String(body.tag_name ?? "").replace(/^v/i, "").trim();
    const apk = (body.assets ?? []).find((a) =>
      a.name?.toLowerCase().endsWith(".apk")
    );

    // A release with no APK attached is not a usable answer — a phone told to
    // update to a version it cannot download is worse than being told nothing.
    if (!tag || !apk?.browser_download_url) return fallback();

    return { latest: tag, downloadUrl: apk.browser_download_url };
  } catch {
    return fallback();
  }
};

export const getLatestMobileRelease = async (): Promise<Release> => {
  const fresh = cached && Date.now() - cachedAt < CACHE_TTL_MS;
  if (fresh && cached) return cached;

  // Collapse concurrent misses into one upstream request, so a burst of app
  // launches after a cache expiry does not spend the whole rate-limit budget.
  if (!inFlight) {
    inFlight = fetchLatest()
      .then((release) => {
        cached = release;
        cachedAt = Date.now();
        return release;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
};
