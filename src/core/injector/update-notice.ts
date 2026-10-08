import { t } from "../i18n";
import { showNotice } from "./notice";

/** Says that a newer version of the app can be installed. The button leads to where that is done. */
export function showUpdateNotice(version: string, openSettings: () => void, doc: Document = document): void {
  showNotice(t("Version {version} of the app is available", { version }), { label: t("Show"), onClick: openSettings }, doc);
}
