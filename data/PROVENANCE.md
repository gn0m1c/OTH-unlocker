Catalog derived from the game's scriptable-object bundle during the October 30, 2026 investigation, build `26.10.30_426818B`.

- Source bundle SHA-256: `8c5e64b14287749d8bdf22b8d2b37332ad71e9270684e2b9c67c11c933605ce8`.
- Catalog membership uses its 480 referenced assets. RequiredDlc must equal zero. Liveries must reference an included vehicle. This excludes paid cosmetics and uncataloged cars/parts.
- Money ID: `1608550983`. Type values: 0 money, 1 vehicle, 2 upgrade, 3 cosmetic, 4 tool, 5 regular livery, 6 special livery.
- Native `InventoryUtility.IsOwned` at `0x180d3cd80` and `0x180d3cec0` confirms positive-count ownership and per-vehicle state checks. Regular liveries are intrinsically available; explicit positive counts retain their records.
- Vehicle-specific serialization at `0x180bc1e00` retains positive-count states. Existing upgrade and cosmetic records use this format. Existing tools use ordinary inventory records.
- Save formats and direct special-livery restart tests established the baseline editor. The original investigation did not visually test every upgrade/tool combination. This repository's tests validate editing and rollback, not gameplay behavior on newer builds.

Only minimal item identifiers, internal names, and type numbers are distributed. No save data or game binary is included.
