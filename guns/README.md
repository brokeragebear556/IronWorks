# Gun folders

Each folder here is one gun. Ironworks lists them in `order`, then by name.

Everything in this folder is yours and is **never uploaded** (see `.gitignore`). On a fresh install the
two demo guns in `demo/guns/` are copied here so there's something to look at.

```
guns/
  01-daniel-defense-ddm4-v7/
    gun.json          the gun: name, 3D model settings, parts list, fit checks
    parts/            things you bought for this gun, one .json file each
      some-part.json
    photos/           real photos for the Photo view (jpg, png, webp, gif)
      full/           the assembled gun
      lower/          the lower (or frame on a handgun)
      upper/          the upper (or slide)
      parts/some-part/  photos of a part from parts/
  _removed/           where "Remove" moves things (ignored by Ironworks)
```

To add a gun by hand, copy an existing folder, rename it, edit `gun.json`, and reload the page.
Folders starting with `_` or `.` are ignored.

Useful `gun.json` fields:

- `name`, `short`, `order`
- `children`: extra tree rows that open a view, e.g. `{ "name": "My lower", "view": "lower" }`
- `model.kind`: `rifle` or `pistol` (parts can use `bcg` or `chargingHandle`)
- `upgrades.triggers`: catalog ids from `data/catalog.json`. The first one is what's installed
- `bom.lower.rows` / `bom.upper.rows`: `{ "part": "trigger", "label": "Trigger", "value": "..." }`.
  `part` links the row to a piece of the 3D model. Leave it empty for list-only rows
- `checks`: `{ "level": "ok" | "check" | "fail" | "info", "text": "..." }`
- `specs`: free-form facts such as `caliber`, `barrelLength`, `twist`, `brand`, `listPrice`. Filled by Metadata → Look up
- `links`: product pages, `{ "url": "https://…", "label": "palmettostatearmory.com" }`. Used by the Product page provider and price tracking
- `notes`: your own notes
- Receipts uploaded in the Log tab are saved in `receipts/` inside the gun's folder
- `attachments`: `{ "id": "t2", "type": "reddot", "name": "Aimpoint T-2", "details": "...", "position": "rear" | "middle" | "front", "side": "right" | "left" | "top" | "bottom", "color": "black" | "fde" | "ddc" | "odgreen" | "grey" }`.
  Types are listed under `attachments` in `data/catalog.json`. The Add attachment button writes these for you
