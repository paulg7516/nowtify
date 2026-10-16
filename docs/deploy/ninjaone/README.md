# Mac rollout with NinjaOne

One ShellScript automation, "Update Nowtify" (`update-nowtify.sh`), Mac,
Run as System. For each release, change `VERSION` at the top and run it
on all company Macs. The release must be published on GitHub first (the
script downloads the DMG from the release and checks it against the
release's latest-mac.yml checksum).

It updates in place (old copy kept until the new one is verified, restored
on failure), sets the app owned by root (IT-managed: no update pop-ups),
and quietly reopens Nowtify in the menu bar for whoever had it running.
Running it again on an up-to-date Mac does nothing. Filter results by
Failure; the log line says why.
