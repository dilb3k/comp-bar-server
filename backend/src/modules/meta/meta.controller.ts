import { getLatestMobileRelease } from "./latest-release";
import { getLatestDesktopRelease } from "./desktop-release";

export const metaController = {
  async getAppVersion() {
    // Both lookups are independently cached and never throw, so one failing
    // upstream cannot take the other's answer down with it.
    const [mobile, desktop] = await Promise.all([
      getLatestMobileRelease(),
      getLatestDesktopRelease(),
    ]);
    return { mobile, desktop };
  },
};
