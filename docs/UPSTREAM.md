# Working with Dewarr

Storyarr is a fork of [Dewarr](https://github.com/logabell/dewarr). Changes flow both ways:

- **Dewarr → Storyarr:** each Dewarr release is merged in, tested, and shipped as a Storyarr release.
- **Storyarr → Dewarr:** bug fixes that help every Dewarr user are offered back as small pull requests.
  Storyarr's features stay in Storyarr unless Dewarr asks for them.

## Branches

| Branch | Where | What it is |
|---|---|---|
| `main` | This repository | Storyarr. Never rewritten. |
| `upstream-main` | Your clone only | A copy of Dewarr's `main`. Never edited. |
| `sync/vX.Y.Z` | Your clone, then a pull request here | One Dewarr release being merged in. |
| `contrib/<topic>` | A Dewarr fork | One fix rebuilt on Dewarr's `main`, with Dewarr's name and wording. |

Set up a clone once:

```sh
git remote add upstream https://github.com/logabell/dewarr.git
git fetch upstream --tags
git branch upstream-main upstream/main
```

## Knowing when Dewarr changes

The **Dewarr watch** workflow runs every Monday. When Dewarr has commits that Storyarr does not, it opens or
updates one issue labelled `upstream`, listing new releases, new database migrations and every commit. Run it
by hand from the Actions tab at any time.

The base it compares against is in `.github/upstream-base`: a commit and the Dewarr release it belongs to.

## Bringing in a Dewarr release

Merge releases, not every commit on Dewarr's `main`.

1. Update your copy and start a branch:

   ```sh
   git fetch upstream --tags
   git branch -f upstream-main upstream/main
   git switch -c sync/vX.Y.Z main
   git merge vX.Y.Z
   ```

2. **Conflicts from the name.** Most conflicts are text where Dewarr changed a sentence that Storyarr renamed.
   Take Dewarr's version, then run:

   ```sh
   python3 scripts/storyarr_rename.py --apply
   ```

   It renames Dewarr to Storyarr in code and tests, and lists anything left in the docs. It also restores the
   lowercase names Storyarr changed (the package, logger, database defaults, CI image names and the deploy
   overrides), while leaving `x-dewarr-proxy-token` and the `dewarr-` download folders alone. CI runs the same
   check without `--apply`, so a missed one fails the build.

3. **Database migrations.** Dewarr's new migrations and Storyarr's must form one line again:
   - Add a `# From Dewarr` line to each migration that came from Dewarr, so the naming test accepts it.
   - If Dewarr's first new migration has `down_revision` pointing at Dewarr's last one (`0080_member_setup` for
     v0.3.9), Alembic now has two heads. Add a Storyarr merge migration that joins them:

     ```sh
     uv run alembic merge heads -m "storyarr_NNNN_merge_dewarr_vX_Y_Z"
     ```

     Rename the file and its revision id to start with `storyarr_`.
   - If Dewarr and Storyarr changed the same table or index, make the later migration safe to run twice
     (`IF NOT EXISTS`, or check before changing).
   - Test the downgrade, and add the new revision to `services/app/downgrade.py` if people may need to go back.

4. **Upgrade wizard.** Add a release to `services/app/domain/upgrades.py`: Dewarr's highlights in Storyarr's
   wording, any new settings, and every database change with how to undo it.

5. **Checks.** Run the full server and web test suites, then a real start on a copy of a database from the
   previous Storyarr release.

6. **Release.** Update `.github/upstream-base` to the merged Dewarr release, write the release notes with a
   "Merged Dewarr vX.Y.Z" section, open a pull request from `sync/vX.Y.Z`, and follow
   [Releasing](RELEASING.md).

## Offering a fix to Dewarr

Good candidates are bug fixes and speed fixes that touch Dewarr's own code, such as cancelling page reads when
the browser leaves, or the indexes behind the request counts.

1. Start from Dewarr's `main`, not Storyarr's:

   ```sh
   git switch -c contrib/<topic> upstream-main
   ```

2. Bring the change across by hand or with `git cherry-pick -n`, then:
   - Use Dewarr's name, wording and style. Run `git grep Storyarr` before committing: it should find nothing.
   - Use Dewarr's next plain migration number, such as `0081_...`, for any migration.
   - Run Dewarr's own checks.

3. Push the branch to your Dewarr fork and open a pull request against `logabell/dewarr`. Describe the
   problem it fixes first, then the change.

If Dewarr accepts a fix that Storyarr also has, the next release merge brings Dewarr's version in. Keep one of
the two: for code, take Dewarr's; for a migration, keep Storyarr's revision and make Dewarr's a no-op on
databases that already have the change.
