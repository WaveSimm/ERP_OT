import csv
import re
import json

# Supplier domains & names
suppliers = {
    "AADI": {"domains": ["aanderaa.com", "xylem.com"], "aliases": ["aanderaa", "aadi"]},
    "Aquatec": {"domains": ["aquatecgroup.com"], "aliases": ["aquatec"]},
    "Airmar-EMEA": {"domains": ["airmar.com"], "aliases": ["airmar"]},
    "Allmaritim AS": {"domains": ["allmaritim.no", "allmaritim.com"], "aliases": ["allmaritim"]},
    "Biospherical": {"domains": ["biospherical.com"], "aliases": ["biospherical"]},
    "Blue Robotics": {"domains": ["bluerobotics.com"], "aliases": ["blue robotics"]},
    "C-Max": {"domains": ["cmaxsonar.com"], "aliases": ["c-max", "cmax"]},
    "Chesapeake": {"domains": ["chesapeaketech.com"], "aliases": ["chesapeake"]},
    "Cox": {"domains": ["coxmarine.com"], "aliases": ["cox marine"]},
    "Datem": {"domains": ["datem.co.uk"], "aliases": ["datem"]},
    "DeRegt": {"domains": ["deregt.com"], "aliases": ["deregt", "de regt"]},
    "Deepsea": {"domains": ["deepsea.com"], "aliases": ["deepsea", "deep sea"]},
    "EIVA": {"domains": ["eiva.com", "eiva.dk"], "aliases": ["eiva"]},
    "Exail": {"domains": ["exail.com", "ixblue.com", "ixsea.com"], "aliases": ["exail", "ixblue", "ixsea"]},
    "Gavia": {"domains": ["teledyne.com", "teledynemarine.com"], "aliases": ["gavia"]},
    "GEOTEK": {"domains": ["geotek.co.uk"], "aliases": ["geotek"]},
    "Geometrics": {"domains": ["geometrics.com"], "aliases": ["geometrics"]},
    "Geospectrum": {"domains": ["geospectrum.ca"], "aliases": ["geospectrum"]},
    "Gill Instruments": {"domains": ["gillinstruments.com", "gill.co.uk"], "aliases": ["gill instruments", "gill"]},
    "Idronaut": {"domains": ["idronaut.it"], "aliases": ["idronaut"]},
    "ITRES Research Limited": {"domains": ["itres.com"], "aliases": ["itres"]},
    "JW Fishers": {"domains": ["jwfishers.com"], "aliases": ["jw fishers", "jwfishers"]},
    "Kley France": {"domains": ["kleyfrance.com"], "aliases": ["kley"]},
    "Marianda": {"domains": ["marianda.com"], "aliases": ["marianda"]},
    "Marine Magnetics": {"domains": ["marinemagnetics.com"], "aliases": ["marine magnetics"]},
    "Metocean": {"domains": ["metocean.com"], "aliases": ["metocean"]},
    "Miros": {"domains": ["miros-group.com", "miros.no"], "aliases": ["miros"]},
    "Nal Research": {"domains": ["nalresearch.com", "naltec.com"], "aliases": ["nal research", "naltec"]},
    "Neptune Sonar": {"domains": ["neptunesonar.co.uk"], "aliases": ["neptune sonar"]},
    "Oceaneering": {"domains": ["oceaneering.com"], "aliases": ["oceaneering"]},
    "Open Ocean Robotics": {"domains": ["openoceanrobotics.com"], "aliases": ["open ocean"]},
    "RESON": {"domains": ["reson.com"], "aliases": ["reson"]},
    "RTSYS": {"domains": ["rtsys.com", "rtsys.eu", "rtsys.fr"], "aliases": ["rtsys"]},
    "SeaTrac": {"domains": ["blueprintsubsea.com"], "aliases": ["blueprint subsea", "seatrac"]},
    "Seafloor Systems": {"domains": ["seafloorsystems.com"], "aliases": ["seafloor systems"]},
    "Septentrio": {"domains": ["septentrio.com"], "aliases": ["septentrio"]},
    "Sercel": {"domains": ["sercel.com"], "aliases": ["sercel"]},
    "SIG": {"domains": ["sig-france.com", "sig-france.fr"], "aliases": ["sig france"]},
    "SIREHNA": {"domains": ["sirehna.com", "naval-group.com"], "aliases": ["sirehna"]},
    "Sofar Ocean": {"domains": ["sofarocean.com"], "aliases": ["sofar"]},
    "Sound Metrics": {"domains": ["soundmetrics.com"], "aliases": ["sound metrics"]},
    "Technicap": {"domains": ["technicap.com"], "aliases": ["technicap"]},
    "Teledyne Benthos": {"domains": ["teledyne.com", "teledynemarine.com", "benthos.com"], "aliases": ["benthos", "teledyne benthos"]},
    "Teledyne CARIS": {"domains": ["teledynecaris.com", "caris.com"], "aliases": ["caris", "teledyne caris"]},
    "Teledyne Marine": {"domains": ["teledyne.com", "teledynemarine.com"], "aliases": ["teledyne marine", "teledyne"]},
    "Teledyne Optech": {"domains": ["teledyneoptech.com", "optech.com"], "aliases": ["optech", "teledyne optech"]},
    "Water Linked": {"domains": ["waterlinked.com"], "aliases": ["water linked", "waterlinked"]},
    "Webb Research": {"domains": ["webbresearch.com"], "aliases": ["webb research"]},
    "ZLS": {"domains": ["zlscorp.com"], "aliases": ["zls"]},
    "Ardusimple": {"domains": ["ardusimple.com"], "aliases": ["ardusimple"]},
    "ASC scientific": {"domains": ["ascscientific.com"], "aliases": ["asc scientific"]},
}

# Read CSV
contacts = []
with open("E:/claude/ERP_OT/References/contacts.csv", "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        contacts.append(row)

# Match
results = {}
for contact in contacts:
    first = (contact.get("First Name") or "").strip().strip("'#")
    middle = (contact.get("Middle Name") or "").strip()
    last = (contact.get("Last Name") or "").strip().strip("'")
    org = (contact.get("Organization Name") or "").strip()
    title = (contact.get("Organization Title") or "").strip()

    emails = []
    for i in range(1, 4):
        email = (contact.get(f"E-mail {i} - Value") or "").strip()
        if email:
            emails.append(email)

    phones = []
    for i in range(1, 6):
        phone = (contact.get(f"Phone {i} - Value") or "").strip()
        plabel = (contact.get(f"Phone {i} - Label") or "").strip()
        if phone:
            phones.append({"label": plabel, "value": phone})

    if not emails and not org:
        continue

    # Try domain matching first
    matched_supplier = None
    for email in emails:
        domain = email.split("@")[-1].lower() if "@" in email else ""
        for supplier, info in suppliers.items():
            for d in info["domains"]:
                if domain == d or domain.endswith("." + d):
                    matched_supplier = supplier
                    break
            if matched_supplier:
                break
        if matched_supplier:
            break

    # Try org name matching
    if not matched_supplier and org:
        org_lower = org.lower()
        for supplier, info in suppliers.items():
            for alias in info["aliases"]:
                if alias in org_lower or org_lower in alias:
                    matched_supplier = supplier
                    break
            if matched_supplier:
                break

    if matched_supplier:
        name_parts = [first, middle, last]
        full_name = " ".join(p for p in name_parts if p)

        entry = {
            "name": full_name,
            "position": title,
            "emails": emails,
            "phones": phones,
            "org": org,
        }

        if matched_supplier not in results:
            results[matched_supplier] = []
        results[matched_supplier].append(entry)

# Deduplicate by email (keep first occurrence with most info)
deduped = {}
for supplier in sorted(results.keys()):
    seen_emails = set()
    unique = []
    for c in results[supplier]:
        primary_email = c["emails"][0].lower() if c["emails"] else ""
        if primary_email and primary_email in seen_emails:
            continue
        if primary_email:
            seen_emails.add(primary_email)
        # Skip garbage data
        if not c["name"] or len(c["name"]) < 2:
            continue
        unique.append(c)
    if unique:
        deduped[supplier] = unique

# Generate SQL for supplier_contacts
sqls = []
for supplier in sorted(deduped.keys()):
    for c in deduped[supplier]:
        name = c["name"].replace("'", "''")
        position = (c["position"] or "").replace("'", "''")
        email = c["emails"][0] if c["emails"] else ""
        # Get best phone (prefer Mobile, then Work)
        phone = ""
        for p in c["phones"]:
            if not phone or "Mobile" in p["label"]:
                val = p["value"].split(":::")[0].strip()
                if val and len(val) > 3:
                    phone = val
                    if "Mobile" in p["label"]:
                        break

        sqls.append(f"INSERT INTO equipment.supplier_contacts (id, supplier_id, name, position, email, phone) "
                     f"SELECT 'sc_' || substr(md5('{email}'), 1, 20), s.id, '{name}', "
                     f"NULLIF('{position}', ''), NULLIF('{email}', ''), NULLIF('{phone}', '') "
                     f"FROM equipment.suppliers s WHERE s.name = '{supplier.replace(chr(39), chr(39)+chr(39))}' "
                     f"ON CONFLICT DO NOTHING;")

# Write SQL file
with open("E:/claude/ERP_OT/tmp_contacts.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(sqls))

# Summary output
import sys
sys.stdout.reconfigure(encoding='utf-8')
total = 0
for supplier in sorted(deduped.keys()):
    contacts_list = deduped[supplier]
    total += len(contacts_list)
    print(f"{supplier}: {len(contacts_list)}명")
    for c in contacts_list:
        phone = ""
        for p in c["phones"]:
            val = p["value"].split(":::")[0].strip()
            if val and len(val) > 3:
                phone = val
                break
        print(f"  - {c['name']} | {c['position'] or '-'} | {c['emails'][0] if c['emails'] else '-'} | {phone or '-'}")
print(f"\n총 {len(deduped)}개 제조사, {total}명 담당자")
