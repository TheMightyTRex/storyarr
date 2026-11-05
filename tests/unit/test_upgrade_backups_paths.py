import pytest

from app import upgrade_backups


def test_backup_names_stay_inside_the_backups_folder(tmp_path):
    good = tmp_path / "settings-20261105-120000-manual.json"
    good.write_text("{}")
    assert upgrade_backups.path_for(good.name, tmp_path) == good.resolve()
    for name in (
        "../settings-20261105-120000-manual.json",
        "settings-20261105-120000-manual.json\n",
        "/etc/passwd",
        "settings-20261105-120000-missing.json",
    ):
        with pytest.raises(FileNotFoundError):
            upgrade_backups.path_for(name, tmp_path)
