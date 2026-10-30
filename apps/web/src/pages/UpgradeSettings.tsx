import { Link } from "react-router-dom";
import SettingsGroup from "../components/SettingsGroup";
import UpgradeBackups, { useUpgrade } from "../components/UpgradeBackups";

export default function UpgradeSettings() {
  const upgrade = useUpgrade();
  return (
    <>
      <SettingsGroup
        id="settings-backups"
        title="Settings backups"
        description="Copies of your settings, taken before each upgrade or by hand."
      >
        <p>
          A settings backup holds your connections, libraries, lists, download
          and automation settings. It does not hold books, downloads or history.
          Backups are saved in the upgrade-backups folder inside /config.
        </p>
        <UpgradeBackups />
      </SettingsGroup>
      <SettingsGroup
        id="upgrade-wizard"
        title="Upgrade wizard"
        description="What changed in recent versions, and the new settings to review."
      >
        <p>
          {upgrade.data
            ? `You are on version ${upgrade.data.release}.`
            : "Checking your version…"}
        </p>
        <Link to="/upgrade">Open the upgrade wizard</Link>
      </SettingsGroup>
    </>
  );
}
