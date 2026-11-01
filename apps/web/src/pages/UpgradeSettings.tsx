import { Link } from "react-router-dom";
import SettingsGroup from "../components/SettingsGroup";
import { ReleaseList } from "../components/ApplicationRelease";
import UpgradeBackups, {
  AutomaticUpgrades,
  useUpgrade,
} from "../components/UpgradeBackups";

export default function UpgradeSettings() {
  const upgrade = useUpgrade();
  const data = upgrade.data;
  const version = data ? `v${data.version}` : "this version";
  return (
    <>
      <SettingsGroup
        id="releases"
        title="Releases"
        description="Every Storyarr release and its notes, newest first."
      >
        <ReleaseList />
      </SettingsGroup>
      <SettingsGroup
        id="restore-previous-version"
        title="Restore previous version"
        description="Put your settings back as they were before an upgrade, then start the previous version again."
      >
        <h3>1. Restore your settings</h3>
        <p>
          Every upgrade saves a settings backup first. Choose the backup taken
          before the upgrade and select Restore settings. It holds your
          connections, libraries, lists, download and automation settings, not
          books, downloads or history. Your current settings are saved first, so
          a restore can be undone. Backups are kept in the upgrade-backups
          folder inside /config.
        </p>
        <UpgradeBackups />
        <h3>2. Undo database changes</h3>
        {data?.way_back?.database_changes.length ? (
          <>
            <p>{data.way_back.title} changed the database:</p>
            <ul>
              {data.way_back.database_changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            {data.way_back.rollback && <p>{data.way_back.rollback}</p>}
          </>
        ) : (
          <p>
            {data
              ? `${version} made no database changes, so there is nothing to undo.`
              : "Checking your version…"}
          </p>
        )}
        <h3>3. Start the previous version</h3>
        <p>
          You are on {version}. In your compose file, change the Storyarr image
          tag back to the version you had before, then pull and restart the
          Storyarr service:
        </p>
        <pre>
          <code>
            docker compose pull storyarr{"\n"}docker compose up -d storyarr
          </code>
        </pre>
      </SettingsGroup>
      <SettingsGroup
        id="upgrade-wizard"
        title="Upgrades"
        description="How upgrades finish, and the wizard for new settings."
      >
        <p>
          {data ? `You are on ${version}.` : "Checking your version…"} The
          upgrade wizard opens only when a new version has settings to choose,
          or changes to your configuration or database. Other upgrades finish on
          their own after the settings backup. Their notes are under the version
          number in the menu.
        </p>
        {data?.pending && (
          <p>
            <Link to="/upgrade">Open the upgrade wizard</Link>
          </p>
        )}
        <AutomaticUpgrades />
      </SettingsGroup>
    </>
  );
}
