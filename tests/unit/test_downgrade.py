from app import downgrade


def test_only_known_releases_are_offered(capsys):
    assert downgrade.main([]) == 2
    assert downgrade.main(["base"]) == 2
    assert "0080_member_setup  (Dewarr v0.3.9)" in capsys.readouterr().err


def test_a_known_release_runs_the_alembic_downgrade(monkeypatch):
    calls = []
    monkeypatch.setenv("DB_PASSWORD", "secret")
    monkeypatch.setenv("CONFIG_DIR", "/tmp/storyarr-downgrade-test")
    monkeypatch.setattr(downgrade.subprocess, "call", lambda args: calls.append(args) or 0)
    assert downgrade.main(["0080_member_setup"]) == 0
    assert calls == [["alembic", "downgrade", "0080_member_setup"]]
