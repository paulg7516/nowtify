# Mac rollout with NinjaOne

NinjaOne's "Install application" skips any Mac that already has
/Applications/Nowtify.app, so each release runs three steps in order
(each Mac, Run as System; wait for each to finish):

1. `1-delete-nowtify.sh` (ShellScript "Delete Nowtify") - notes who had
   Nowtify running, quits it, removes the old app. Settings are kept.
2. Install application "Nowtify macOS <version>" with the new DMG.
3. `3-nowtify-install-status-check.sh` (ShellScript "Nowtify Install Status
   Check") - checks the version and that there's one clean copy, makes the
   app owned by root (IT-managed: no self-updates), and quietly reopens
   Nowtify in the menu bar for whoever had it running.

For each release: point step 2 at the new DMG and set `EXPECTED` in step 3.
Filter NinjaOne results by Failure; the log line says what to re-run.
