import csv, sys, re, json
sys.stdout.reconfigure(encoding='utf-8')

# Customer name -> matching rules (domains, aliases, org keywords)
customers = {
    "KHOA": {"domains": ["khoa.go.kr"], "aliases": ["khoa", "국립해양조사원", "해양조사원"]},
    "KIGAM": {"domains": ["kigam.re.kr"], "aliases": ["kigam", "한국지질자원연구원", "지질자원연구원"]},
    "KIOST": {"domains": ["kiost.ac.kr", "kiost.ac"], "aliases": ["kiost", "한국해양과학기술원", "해양과학기술원"]},
    "KOPRI": {"domains": ["kopri.re.kr"], "aliases": ["kopri", "극지연구소"]},
    "KRISO": {"domains": ["kriso.re.kr"], "aliases": ["kriso", "선박해양플랜트연구소"]},
    "KIMST": {"domains": ["kimst.re.kr"], "aliases": ["kimst", "해양과학기술진흥원"]},
    "KAI": {"domains": ["koreaaero.com", "kai.co.kr"], "aliases": ["kai", "한국항공우주산업", "korea aerospace"]},
    "KOINS": {"domains": ["koins.or.kr"], "aliases": ["koins"]},
    "MIT": {"domains": ["mit.edu"], "aliases": ["mit", "massachusetts institute"]},
    "UST21": {"domains": ["ust21.com"], "aliases": ["ust21"]},
    "CNC OCENA": {"domains": ["cncocena.com"], "aliases": ["cnc ocena", "cncocena"]},
    "LIG넥스원": {"domains": ["lignex1.com"], "aliases": ["lig넥스원", "lig nex1", "lignex"]},
    "Southern Tech Solutions": {"domains": ["southerntechsolutions.com"], "aliases": ["southern tech"]},
    "서울대학교": {"domains": ["snu.ac.kr"], "aliases": ["서울대학교", "서울대"]},
    "부경대": {"domains": ["pknu.ac.kr"], "aliases": ["부경대"]},
    "인하대": {"domains": ["inha.ac.kr", "inha.edu"], "aliases": ["인하대"]},
    "강원대학교": {"domains": ["kangwon.ac.kr"], "aliases": ["강원대"]},
    "전남대": {"domains": ["jnu.ac.kr", "chonnam.ac.kr"], "aliases": ["전남대"]},
    "군산대": {"domains": ["kunsan.ac.kr"], "aliases": ["군산대"]},
    "고려대": {"domains": ["korea.ac.kr"], "aliases": ["고려대"]},
    "부산대학교": {"domains": ["pusan.ac.kr"], "aliases": ["부산대"]},
    "한국해양대학교": {"domains": ["kmou.ac.kr", "hhu.ac.kr"], "aliases": ["한국해양대", "해양대학교"]},
    "위덕대학교": {"domains": ["uu.ac.kr"], "aliases": ["위덕대"]},
    "한국과학기술원": {"domains": ["kaist.ac.kr", "kaist.edu"], "aliases": ["kaist", "한국과학기술원"]},
    "국립수산과학원": {"domains": ["nifs.go.kr"], "aliases": ["국립수산과학원", "수산과학원"]},
    "한국기상산업기술원": {"domains": ["kma.go.kr", "kwei.or.kr"], "aliases": ["기상산업기술원", "기상청"]},
    "기상청": {"domains": ["kma.go.kr"], "aliases": ["기상청"]},
    "한국수자원공사": {"domains": ["kwater.or.kr"], "aliases": ["수자원공사", "k-water"]},
    "한국에너지기술연구원": {"domains": ["kier.re.kr"], "aliases": ["에너지기술연구원"]},
    "삼성중공업 거제조선소": {"domains": ["shi.samsung.co.kr"], "aliases": ["삼성중공업"]},
    "삼성물산": {"domains": ["samsungcnt.com"], "aliases": ["삼성물산"]},
    "한화시스템": {"domains": ["hanwha.com", "hanwhasystems.com"], "aliases": ["한화시스템"]},
    "대우이앤씨": {"domains": ["daewooenc.com"], "aliases": ["대우이앤씨", "대우건설"]},
    "오션테크": {"domains": ["oceantech.co.kr"], "aliases": ["오션테크"]},
    "미래해양": {"domains": ["miraeocean.com"], "aliases": ["미래해양"]},
    "에스엠오션": {"domains": ["smocean.co.kr"], "aliases": ["에스엠오션", "sm오션"]},
    "해양정보기술": {"domains": ["maris.co.kr", "oceanit.co.kr"], "aliases": ["해양정보기술"]},
    "해안해양기술": {"domains": ["coastaltech.co.kr", "cot.co.kr"], "aliases": ["해안해양기술"]},
    "지오시스템리서치": {"domains": ["geosystem.co.kr", "geosr.com"], "aliases": ["지오시스템리서치", "지오시스템"]},
    "지오뷰": {"domains": ["geoview.co.kr"], "aliases": ["지오뷰"]},
    "메이텍엔지니어링": {"domains": ["maytech.co.kr"], "aliases": ["메이텍"]},
    "오셔닉": {"domains": ["oceanic.co.kr"], "aliases": ["오셔닉"]},
    "엘티메트릭": {"domains": ["ltmetric.com", "ltmetric.co.kr"], "aliases": ["엘티메트릭"]},
    "세광종합기술단": {"domains": ["sekwang.co.kr"], "aliases": ["세광종합기술단", "세광"]},
    "파랑해양기술": {"domains": ["parangoce.co.kr", "parang.co.kr"], "aliases": ["파랑해양"]},
    "동문시스텍": {"domains": ["dongmoon.co.kr", "dmsystech.com"], "aliases": ["동문시스텍"]},
    "선영엔지니어링": {"domains": ["sunyoung.co.kr", "syeng.co.kr"], "aliases": ["선영엔지니어링"]},
    "이엔씨기술": {"domains": ["enc-tech.co.kr"], "aliases": ["이엔씨기술"]},
    "올포랜드": {"domains": ["allforland.co.kr"], "aliases": ["올포랜드"]},
    "조사협회": {"domains": ["khsa.or.kr"], "aliases": ["한국해양조사협회", "조사협회"]},
    "전략해양": {"domains": ["kosi.re.kr"], "aliases": ["전략해양"]},
    "㈜오션": {"domains": ["oc-ean.com"], "aliases": ["오션"]},
    "오션그래픽": {"domains": ["oceangraphic.co.kr"], "aliases": ["오션그래픽"]},
    "오션사이언스": {"domains": ["oceanscience.co.kr"], "aliases": ["오션사이언스"]},
    "소나테크": {"domains": ["sonatech.co.kr"], "aliases": ["소나테크"]},
    "에이스해양": {"domains": ["aceocean.co.kr"], "aliases": ["에이스해양"]},
    "한일뉴즈": {"domains": ["hanilnews.co.kr"], "aliases": ["한일뉴즈"]},
    "씨엔에스솔루션": {"domains": ["cnssolution.co.kr"], "aliases": ["씨엔에스솔루션"]},
    "국토해양환경기술단": {"domains": ["komet.or.kr"], "aliases": ["국토해양환경기술단"]},
    "인터오션": {"domains": ["interocean.co.kr"], "aliases": ["인터오션"]},
    "어비스테크": {"domains": ["abysstech.co.kr"], "aliases": ["어비스테크"]},
    "에이샛": {"domains": ["asat.co.kr"], "aliases": ["에이샛"]},
    "과학기지": {"domains": [], "aliases": ["해양과학기지", "과학기지"]},
    "로마스": {"domains": ["lomas.co.kr"], "aliases": ["로마스"]},
    "로고스웨어": {"domains": ["logosware.co.kr"], "aliases": ["로고스웨어"]},
    "더모스트": {"domains": ["themost.co.kr"], "aliases": ["더모스트"]},
    "비엘프로세스": {"domains": ["blprocess.co.kr"], "aliases": ["비엘프로세스"]},
}

contacts_data = []
with open("E:/claude/ERP_OT/References/contacts.csv", "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        contacts_data.append(row)

def match_customer(contact):
    org = (contact.get("Organization Name") or "").strip()
    emails = []
    for i in range(1, 4):
        e = (contact.get(f"E-mail {i} - Value") or "").strip()
        if e:
            emails.append(e)

    # Domain match
    for email in emails:
        domain = email.split("@")[-1].lower() if "@" in email else ""
        for cust, info in customers.items():
            for d in info["domains"]:
                if domain == d or domain.endswith("." + d):
                    return cust
    # Org name match
    if org:
        org_lower = org.lower()
        for cust, info in customers.items():
            for alias in info["aliases"]:
                if alias.lower() in org_lower or org_lower in alias.lower():
                    return cust
    return None

# Collect contacts and info per customer
results = {}
customer_info = {}

for contact in contacts_data:
    matched = match_customer(contact)
    if not matched:
        continue

    first = (contact.get("First Name") or "").strip().strip("'#")
    middle = (contact.get("Middle Name") or "").strip()
    last = (contact.get("Last Name") or "").strip().strip("'")
    org = (contact.get("Organization Name") or "").strip()
    title = (contact.get("Organization Title") or "").strip()
    dept = (contact.get("Organization Department") or "").strip()

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
            phones.append({"label": plabel, "value": phone.split(":::")[0].strip()})

    # Address for customer info
    addr = (contact.get("Address 1 - Formatted") or "").strip()
    if addr and len(addr) > 5 and matched not in customer_info:
        addr_clean = re.sub(r'\s*\n\s*', ', ', addr).strip()
        if not re.search(r'[A-Za-z0-9+/]{20,}=', addr_clean):
            customer_info[matched] = {"address": addr_clean}

    name_parts = [first, middle, last]
    full_name = " ".join(p for p in name_parts if p)

    if not full_name or len(full_name) < 2:
        continue
    # Skip garbage data
    if re.search(r'[A-Za-z0-9+/]{20,}=', full_name):
        continue

    primary_email = emails[0] if emails else ""

    # Best phone
    phone = ""
    for p in phones:
        val = p["value"]
        if val and len(val) > 3:
            if not phone or "Mobile" in p["label"]:
                phone = val
                if "Mobile" in p["label"]:
                    break

    entry = {
        "name": full_name,
        "department": dept,
        "position": title,
        "email": primary_email,
        "phone": phone,
    }

    if matched not in results:
        results[matched] = []

    # Dedup by email
    existing_emails = {c["email"].lower() for c in results[matched] if c["email"]}
    if primary_email and primary_email.lower() in existing_emails:
        continue
    results[matched].append(entry)

# Generate SQL: customer_contacts inserts
contact_sqls = []
for cust in sorted(results.keys()):
    for c in results[cust]:
        name = c["name"].replace("'", "''")
        dept = (c["department"] or "").replace("'", "''")
        pos = (c["position"] or "").replace("'", "''")
        email = (c["email"] or "").replace("'", "''")
        phone = (c["phone"] or "").replace("'", "''")
        safe_cust = cust.replace("'", "''")

        contact_sqls.append(
            f"INSERT INTO equipment.customer_contacts (id, \"customerId\", name, department, position, phone, email, \"isPrimary\", \"updatedAt\") "
            f"SELECT 'cc_' || substr(md5('{email}_{safe_cust}'), 1, 20), c.id, '{name}', "
            f"NULLIF('{dept}', ''), NULLIF('{pos}', ''), NULLIF('{phone}', ''), NULLIF('{email}', ''), false, NOW() "
            f"FROM equipment.customers c WHERE c.name = '{safe_cust}' "
            f"ON CONFLICT DO NOTHING;"
        )

# Generate SQL: customer info updates (address, phone, email from first contact)
info_sqls = []
for cust in sorted(results.keys()):
    contacts_list = results[cust]
    updates = []

    # Address
    if cust in customer_info:
        addr = customer_info[cust]["address"].replace("'", "''")
        updates.append(f"address = '{addr}'")

    # Use first contact's info for customer-level phone/email
    if contacts_list:
        first_contact = contacts_list[0]
        if first_contact["phone"]:
            ph = first_contact["phone"].replace("'", "''")
            updates.append(f"phone = '{ph}'")
        if first_contact["email"]:
            em = first_contact["email"].replace("'", "''")
            updates.append(f"email = '{em}'")
        if first_contact["name"]:
            nm = first_contact["name"].replace("'", "''")
            updates.append(f"\"contactPerson\" = '{nm}'")

    if updates:
        safe_cust = cust.replace("'", "''")
        info_sqls.append(
            f"UPDATE equipment.customers SET {', '.join(updates)}, \"updatedAt\" = NOW() "
            f"WHERE name = '{safe_cust}' AND \"contactPerson\" IS NULL;"
        )

# Write SQL files
with open("E:/claude/ERP_OT/tmp_customer_contacts.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(contact_sqls))

with open("E:/claude/ERP_OT/tmp_customer_info.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(info_sqls))

# Summary
total_contacts = 0
for cust in sorted(results.keys()):
    cl = results[cust]
    total_contacts += len(cl)
    addr_mark = " [주소]" if cust in customer_info else ""
    print(f"{cust}: {len(cl)}명{addr_mark}")
    for c in cl:
        print(f"  - {c['name']} | {c['position'] or '-'} | {c['email'] or '-'} | {c['phone'] or '-'}")

print(f"\n총 {len(results)}개 고객사, {total_contacts}명 담당자")
print(f"고객사 기본정보 업데이트: {len(info_sqls)}건")
