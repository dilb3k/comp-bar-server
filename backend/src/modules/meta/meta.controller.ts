import { env } from "../../config/env";

export const metaController = {
  getAppVersion() {
    return {
      mobile: {
        latest: env.MOBILE_LATEST_VERSION,
        downloadUrl: env.MOBILE_DOWNLOAD_URL
      }
    };
  }
};
