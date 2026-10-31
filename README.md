# Over the Hill save unlocker

A Windows single-player save editor. Unlocks all identified earnable base-game vehicles, cosmetics, colors/liveries, upgrades, and tools. Sets currency to **exactly 10,000** each run (it does not add 10,000). Paid DLC and excluded/unreleased assets are omitted.

## Run

Install Node.js 22 or newer. No packages or game files are needed. Close the game, open a terminal in this folder, then:

```powershell
node unlock.cjs          # preview; writes nothing
node unlock.cjs --apply  # back up, unlock, and verify
```

The default profile is `Documents\My Games\over the hill\Saves\Player1.json`, including redirected Documents folders. Use `--save "C:\path\Player2.json"` for another profile. Launch through Steam, equip an item or upgrade, exit normally, and restart to confirm persistence.

## How it works

The bundled catalog contains 21 vehicles, 155 cosmetics, 139 regular liveries, 84 special liveries, 16 upgrades, seven tools, and one currency ID. The script merges ownership into `Profile.Inventory.Items`; upgrades and cosmetics get ownership states for all 21 vehicles. It retains existing equipment, mileage, counts above one, objectives, and other progress. New equipment is owned but not automatically equipped. Tools receive at least one copy. Game binaries are untouched.

Every write creates a timestamped, hash-verified copy of the whole Saves folder in `backups/`. Duplicate IDs, unsupported versions, unexpected record types, a running game, or a changed source save stop installation. Backups and personal saves are excluded from Git.

## Undo

Close the game and use the backup folder printed by the unlock command:

```powershell
node unlock.cjs --restore "backups\TIMESTAMP"          # preview
node unlock.cjs --restore "backups\TIMESTAMP" --apply  # restore
```

Restore first backs up your current saves, then restores the selected profile to its backup-time progress and updates its `.bak` fallback. Later progress in that profile is lost; fog-of-war and animal files are left alone. Full copies remain available in each backup's `Saves` subfolder. Check any Steam cloud conflict carefully so the intended local save is retained.

## Compatibility and checks

Catalog: build `26.10.30_426818B`, Unity `6000.0.75f1`, save versions 15 and 17. Cars, cosmetics, liveries, and currency were tested in the original investigation. Upgrade/tool handling follows existing save records and ownership serialization; the packaged full-upgrade edit still needs an in-game check. Multiplayer and cloud conflict recovery were not tested.

Run `npm test` for offline checks. No personal saves, game binaries, or original investigation dumps are included. This is an unofficial tool; future game builds may need an updated catalog.

Upload this folder as a Git repository. Add your server with `git remote add origin <URL>`, then run `git push -u origin main`. If starting from the ZIP, first initialize Git and commit the files.
