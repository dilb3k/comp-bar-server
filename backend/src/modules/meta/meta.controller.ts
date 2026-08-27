import { getLatestMobileRelease } from "./latest-release";

export const metaController = {
  async getAppVersion() {
    return {
      mobile: await getLatestMobileRelease(),
    };
  },
};
