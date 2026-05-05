import fiona

GDB = r"C:\Users\justi\Downloads\PADUS4_1Geodatabase\PADUS4_1Geodatabase.gdb"

print("=== Layers ===")
layers = fiona.listlayers(GDB)
for l in layers:
    print(f"  {l}")

# Inspect the Fee layer (most likely to contain state parks)
target = next((l for l in layers if 'Fee' in l), layers[0])
print(f"\n=== Schema for: {target} ===")
with fiona.open(GDB, layer=target) as src:
    print(f"CRS: {src.crs}")
    print(f"Total features: {len(src)}")
    print("Fields:")
    for name, typ in src.schema['properties'].items():
        print(f"  {name}: {typ}")

    print("\n=== Sample state park features ===")
    count = 0
    for feat in src:
        p = feat['properties']
        if p.get('Own_Type') == 'STAT' and p.get('Des_Tp') == 'SP':
            print({k: p[k] for k in p if p[k] not in (None, '')})
            count += 1
            if count >= 3:
                break

    print(f"\n=== State park counts by Des_Tp (Own_Type=STAT) ===")
    from collections import Counter
    c = Counter()
    for feat in src:
        p = feat['properties']
        if p.get('Own_Type') == 'STAT':
            c[p.get('Des_Tp', '?')] += 1
    for k, v in c.most_common(20):
        print(f"  {k}: {v}")
