import csv, sys
sys.stdout.reconfigure(encoding='utf-8')

suppliers = {
    "AADI": {"domains": ["aanderaa.com", "xylem.com", "xyleminc.com"], "aliases": ["aanderaa", "aadi"]},
    "Airmar-EMEA": {"domains": ["airmar.com"], "aliases": ["airmar"]},
    "Allmaritim AS": {"domains": ["allmaritim.no", "allmaritim.com"], "aliases": ["allmaritim"]},
    "Biospherical": {"domains": ["biospherical.com"], "aliases": ["biospherical"]},
    "Blue Robotics": {"domains": ["bluerobotics.com"], "aliases": ["blue robotics"]},
    "C-Max": {"domains": ["cmaxsonar.com"], "aliases": ["c-max", "cmax"]},
    "Chesapeake": {"domains": ["chesapeaketech.com"], "aliases": ["chesapeake"]},
    "Deepsea": {"domains": ["deepsea.com"], "aliases": ["deepsea", "deep sea"]},
    "Exail": {"domains": ["exail.com", "ixblue.com", "ixsea.com"], "aliases": ["exail", "ixblue"]},
    "Gavia": {"domains": ["teledyne.com", "teledynemarine.com"], "aliases": ["gavia"]},
    "GEOTEK": {"domains": ["geotek.co.uk"], "aliases": ["geotek"]},
    "Geometrics": {"domains": ["geometrics.com"], "aliases": ["geometrics"]},
    "Geospectrum": {"domains": ["geospectrum.ca"], "aliases": ["geospectrum"]},
    "Gill Instruments": {"domains": ["gillinstruments.com"], "aliases": ["gill instruments"]},
    "Idronaut": {"domains": ["idronaut.it"], "aliases": ["idronaut"]},
    "JW Fishers": {"domains": ["jwfishers.com"], "aliases": ["jw fishers"]},
    "Marine Magnetics": {"domains": ["marinemagnetics.com"], "aliases": ["marine magnetics"]},
    "Miros": {"domains": ["miros-group.com", "miros.no"], "aliases": ["miros"]},
    "Neptune Sonar": {"domains": ["neptunesonar.co.uk"], "aliases": ["neptune sonar"]},
    "Oceaneering": {"domains": ["oceaneering.com"], "aliases": ["oceaneering"]},
    "RESON": {"domains": ["reson.com", "teledyne-reson.com"], "aliases": ["reson"]},
    "RTSYS": {"domains": ["rtsys.com", "rtsys.eu", "rtsys.fr"], "aliases": ["rtsys"]},
    "Seafloor Systems": {"domains": ["seafloorsystems.com"], "aliases": ["seafloor systems"]},
    "Septentrio": {"domains": ["septentrio.com"], "aliases": ["septentrio"]},
    "Sercel": {"domains": ["sercel.com"], "aliases": ["sercel"]},
    "SIREHNA": {"domains": ["sirehna.com"], "aliases": ["sirehna"]},
    "Sofar Ocean": {"domains": ["sofarocean.com"], "aliases": ["sofar"]},
    "Sound Metrics": {"domains": ["soundmetrics.com"], "aliases": ["sound metrics"]},
    "Teledyne Benthos": {"domains": ["benthos.com"], "aliases": ["benthos"]},
    "Teledyne CARIS": {"domains": ["teledynecaris.com", "caris.com"], "aliases": ["caris"]},
    "Teledyne Marine": {"domains": ["teledynemarine.com"], "aliases": ["teledyne marine"]},
    "Teledyne Optech": {"domains": ["teledyneoptech.com", "optech.com"], "aliases": ["optech"]},
    "Water Linked": {"domains": ["waterlinked.com"], "aliases": ["water linked"]},
    "Aquatec": {"domains": ["aquatecgroup.com"], "aliases": ["aquatec"]},
    "Kley France": {"domains": ["kleyfrance.com"], "aliases": ["kley"]},
    "Marianda": {"domains": ["marianda.com"], "aliases": ["marianda"]},
    "Metocean": {"domains": ["metocean.com"], "aliases": ["metocean"]},
    "Nal Research": {"domains": ["nalresearch.com", "naltec.com"], "aliases": ["nal research"]},
    "SIG": {"domains": ["sig-france.com", "sig-france.fr"], "aliases": ["sig france"]},
    "Technicap": {"domains": ["technicap.com"], "aliases": ["technicap"]},
    "Webb Research": {"domains": ["webbresearch.com"], "aliases": ["webb research"]},
    "ZLS": {"domains": ["zlscorp.com"], "aliases": ["zls"]},
    "DeRegt": {"domains": ["deregt.com"], "aliases": ["deregt"]},
    "Datem": {"domains": ["datem.co.uk"], "aliases": ["datem"]},
    "Cox": {"domains": ["coxmarine.com"], "aliases": ["cox marine"]},
    "SeaTrac": {"domains": ["blueprintsubsea.com"], "aliases": ["blueprint subsea", "seatrac"]},
    "Open Ocean Robotics": {"domains": ["openoceanrobotics.com"], "aliases": ["open ocean"]},
    "ITRES Research Limited": {"domains": ["itres.com"], "aliases": ["itres"]},
    "Ardusimple": {"domains": ["ardusimple.com"], "aliases": ["ardusimple"]},
    "ASC scientific": {"domains": ["ascscientific.com"], "aliases": ["asc scientific"]},
    "EIVA": {"domains": ["eiva.com", "eiva.dk"], "aliases": ["eiva"]},
}

contacts = []
with open("E:/claude/ERP_OT/References/contacts.csv", "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        contacts.append(row)

# Collect info per supplier
supplier_info = {}
for contact in contacts:
    org = (contact.get("Organization Name") or "").strip()
    emails = []
    for i in range(1, 4):
        e = (contact.get(f"E-mail {i} - Value") or "").strip()
        if e:
            emails.append(e)

    matched = None
    for email in emails:
        domain = email.split("@")[-1].lower() if "@" in email else ""
        for sup, info in suppliers.items():
            for d in info["domains"]:
                if domain == d or domain.endswith("." + d):
                    matched = sup
                    break
            if matched:
                break
        if matched:
            break

    if not matched and org:
        org_lower = org.lower()
        for sup, info in suppliers.items():
            for alias in info["aliases"]:
                if alias in org_lower or org_lower in alias:
                    matched = sup
                    break
            if matched:
                break

    if not matched:
        continue

    if matched not in supplier_info:
        supplier_info[matched] = {"addresses": [], "websites": []}

    # Address
    addr = (contact.get("Address 1 - Formatted") or "").strip()
    street = (contact.get("Address 1 - Street") or "").strip()
    city = (contact.get("Address 1 - City") or "").strip()
    region = (contact.get("Address 1 - Region") or "").strip()
    postal = (contact.get("Address 1 - Postal Code") or "").strip()
    country = (contact.get("Address 1 - Country") or "").strip()

    if addr and len(addr) > 5:
        supplier_info[matched]["addresses"].append(addr)
    elif street:
        parts = [p for p in [street, city, region, postal, country] if p]
        if parts:
            supplier_info[matched]["addresses"].append(", ".join(parts))

    # Website
    web = (contact.get("Website 1 - Value") or "").strip()
    if web:
        supplier_info[matched]["websites"].append(web)

# Generate SQL updates
sqls = []
for sup in sorted(supplier_info.keys()):
    info = supplier_info[sup]
    addrs = list(set(info["addresses"]))
    webs = list(set(info["websites"]))

    # Pick best address (longest)
    best_addr = max(addrs, key=len) if addrs else ""
    best_web = webs[0] if webs else ""

    updates = []
    if best_addr:
        safe_addr = best_addr.replace("'", "''")
        updates.append(f"address = '{safe_addr}'")
    if best_web:
        safe_web = best_web.replace("'", "''")
        updates.append(f"website = '{safe_web}'")

    if updates:
        safe_name = sup.replace("'", "''")
        # Only update if current value is NULL
        conditions = []
        if best_addr:
            conditions.append("address IS NULL")
        if best_web:
            conditions.append("website IS NULL")
        cond_str = " OR ".join(conditions)
        sql = f"UPDATE equipment.suppliers SET {', '.join(updates)}, updated_at = NOW() WHERE name = '{safe_name}' AND ({cond_str});"
        sqls.append(sql)
        print(f"{sup}:")
        if best_addr:
            print(f"  address: {best_addr}")
        if best_web:
            print(f"  website: {best_web}")

with open("E:/claude/ERP_OT/tmp_supplier_update.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(sqls))

print(f"\n{len(sqls)}개 제조사 업데이트 SQL 생성")
