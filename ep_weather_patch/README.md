# ep_weather_patch

Stand-alone patcher for an existing ExplorerPatcher install: embeds the rebuilt `ExplorerPatcher.amd64.dll`,
`ep_gui.dll`, `ep_weather_host.dll` and `ep_weather_host_stub.dll` (from `..\staging`) and installs them, including the
`C:\Windows\dxgi.dll` copy with its version stamp. Not a replacement for the official `ep_setup.exe`, which needs
components (ep_dwm, ep_starttiledata, L10N) that are empty submodules in this tree.

Build: `build.cmd` -> `out\ep_weather_patch.exe` (requires administrator) and `out\ep_weather_patch_test.exe`
(unelevated, adds `/sandbox <dir>` to run against a copy of the tree; never ship it).

Run: `ep_weather_patch.exe` (asks first) | `/uninstall` | `/silent` | `/force`.
Originals are saved on first install and never overwritten; replaced files are renamed `*.altweather-old-<time>`.
If any file cannot be replaced, the files already swapped are put back.

Tested with the test build against a copy of the old install: install, idempotent re-install, uninstall (byte-exact),
back-to-back runs, and a locked-file failure with rollback. The resulting `dxgi.dll` is byte-identical to the one
`staging\deploy.ps1` produced. The release exe itself has not been run (it needs elevation).
