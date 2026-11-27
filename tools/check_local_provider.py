"""Dev check: show what the local-files provider finds for every gun and part."""
from server import library, providers

lib = library.list_guns()["guns"]
for g in lib:
    for it in [g] + g["parts"]:
        for r in providers.run_local(it):
            d = r.get("data") or {}
            print(f"{it['name'][:34]:34} <- {r['source'][:38]:38} conf={r['confidence']} "
                  f"price={d.get('price')} imgs={len(d.get('images', []))} specs={list(d.get('specs', {}))[:8]} {r.get('error', '')}")
print("unmatched:", providers.unmatched_files(lib))
