"""
ecount → ERP 재고 마이그레이션 — Phase B-2 트랜잭션 import
2026-05-18

입력:
  - data/sources/구매현황(26.01.01~26.04.30).xlsx (337 row)
  - data/sources/판매현황(26.01.01~26.04.30).xlsx (366 row)
  - data/sources/창고이동현황(26.01.01~26.04.30).xlsx (235 row)

출력:
  - inventory_items 신규 생성 / 기존 갱신
  - inventory_transactions 938건 INSERT
  - customer_assets 출고 시 생성 (otInventoryNo cross-ref)

단일 트랜잭션, BEGIN/COMMIT.
"""
import sys, os, openpyxl, psycopg2, re, uuid
from datetime import datetime
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

# 비밀번호는 환경변수에서만 읽음 (하드코딩 금지). 실행: ERP_DB_PASSWORD=... python ...
DB = dict(host='localhost', port=5432, user='erp_user',
          password=os.environ['ERP_DB_PASSWORD'], dbname='erp_ot')

def make_id(prefix='ec'):
    return f'{prefix}_' + uuid.uuid4().hex[:23]

def normalize_name(s):
    if not s: return ''
    s = re.sub(r'\s*\[[^\]]*\]\s*', ' ', s)
    return re.sub(r'\s+', ' ', s).strip().lower()

def normalize_customer(s):
    if not s: return ''
    s = s.replace('(주)', '').replace('(유)', '').replace('주식회사', '').replace('유한회사', '')
    return re.sub(r'\s+', '', s).lower().strip()

def parse_date_seq(v):
    """ecount '일자-No.' → (date, seq)
       '2026/01/06 -1' → (date(2026,1,6), '1')"""
    if not v: return None, None
    s = str(v).strip()
    m = re.match(r'(\d{4})/(\d{1,2})/(\d{1,2})\s*-?\s*(\d+)?', s)
    if not m: return None, None
    y, mo, d, seq = m.groups()
    try:
        return datetime(int(y), int(mo), int(d)).date(), seq
    except ValueError:
        return None, seq

def is_header_row(r):
    if not r or r[0] is None: return True
    s = str(r[0]).strip()
    return s == '일자-No.' or '계' in s or s.startswith('회사명')

# ───────────────────────────────────────────────────
# 1. ecount 파일 로드
# ───────────────────────────────────────────────────
def load_purchase():
    rows = []
    wb = openpyxl.load_workbook("data/sources/구매현황(26.01.01~26.04.30).xlsx",
                                read_only=False, data_only=True)
    for r in wb["구매현황"].iter_rows(values_only=True):
        if is_header_row(r): continue
        d, seq = parse_date_seq(r[0])
        if not d: continue
        rows.append(dict(kind='purchase', date=d, seq=seq,
            item=str(r[1]).strip() if r[1] else None,
            qty=int(r[2]) if r[2] else 1,
            supplier=str(r[3]).strip() if r[3] else None,    # 공급사
            manufacturer=str(r[4]).strip() if r[4] else None, # 거래처명(제조사)
            warehouse=str(r[5]).strip() if r[5] else None,
            serial=str(r[6]).strip() if r[6] and str(r[6]).strip() not in ('', '없음') else None,
            project=str(r[8]).strip() if r[8] else None,
            assignee=str(r[9]).strip() if r[9] else None,
            remarks=' '.join(filter(None, [
                str(r[13]).strip() if r[13] else None,
                str(r[14]).strip() if r[14] else None,
            ])) or None,
            inv_no='#' + str(r[15]).strip().lstrip('#') if r[15] else None,
            purchase_no=str(r[16]).strip() if r[16] else None,
        ))
    wb.close()
    return rows

def load_sales():
    rows = []
    wb = openpyxl.load_workbook("data/sources/판매현황(26.01.01~26.04.30).xlsx",
                                read_only=False, data_only=True)
    for r in wb["판매현황"].iter_rows(values_only=True):
        if is_header_row(r): continue
        d, seq = parse_date_seq(r[0])
        if not d: continue
        rows.append(dict(kind='sale', date=d, seq=seq,
            item=str(r[1]).strip() if r[1] else None,
            qty=int(r[2]) if r[2] else 1,
            serial=str(r[3]).strip() if r[3] and str(r[3]).strip() not in ('', '없음') else None,
            customer=str(r[8]).strip() if r[8] else None,
            project=str(r[9]).strip() if r[9] else None,
            warehouse=str(r[10]).strip() if r[10] else None,
            assignee=str(r[11]).strip() if r[11] else None,
            remarks=str(r[12]).strip() if r[12] else None,
            inv_no='#' + str(r[14]).strip().lstrip('#') if r[14] else None,
        ))
    wb.close()
    return rows

def load_transfer():
    rows = []
    wb = openpyxl.load_workbook("data/sources/창고이동현황(26.01.01~26.04.30).xlsx",
                                read_only=False, data_only=True)
    for r in wb["창고이동현황"].iter_rows(values_only=True):
        if is_header_row(r): continue
        d, seq = parse_date_seq(r[0])
        if not d: continue
        rows.append(dict(kind='transfer', date=d, seq=seq,
            from_wh=str(r[1]).strip() if r[1] else None,
            to_wh=str(r[2]).strip() if r[2] else None,
            item=str(r[3]).strip() if r[3] else None,
            qty=int(r[4]) if r[4] else 1,
            remarks=str(r[7]).strip() if r[7] else None,
            serial=str(r[8]).strip() if r[8] and str(r[8]).strip() not in ('', '없음') else None,
            item_code=str(r[9]).strip() if r[9] else None,
            project=str(r[10]).strip() if r[10] else None,
            assignee=str(r[11]).strip() if r[11] else None,
            inv_no='#' + str(r[6]).strip().lstrip('#') if r[6] else None,
        ))
    wb.close()
    return rows

# ───────────────────────────────────────────────────
# 2. 메인 import
# ───────────────────────────────────────────────────
def main():
    purchases = load_purchase()
    sales = load_sales()
    transfers = load_transfer()
    print(f"로드 완료: 구매 {len(purchases)} / 판매 {len(sales)} / 이동 {len(transfers)} = {len(purchases)+len(sales)+len(transfers)}")

    # 일자 정렬 (구매→이동→판매 동일 일자 시)
    order_key = {'purchase': 0, 'transfer': 1, 'sale': 2}
    all_tx = purchases + transfers + sales
    all_tx.sort(key=lambda x: (x['date'], order_key[x['kind']], x.get('seq') or ''))

    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # 룩업 캐시 빌드
        cur.execute('SELECT id, name FROM equipment.customers;')
        cust_by_name = {}
        cust_by_norm = {}
        for cid, nm in cur.fetchall():
            cust_by_name[nm] = cid
            cust_by_norm[normalize_customer(nm)] = cid

        cur.execute('SELECT id, name FROM equipment.product_masters;')
        pm_by_name = {}
        pm_by_norm = {}
        for pid, nm in cur.fetchall():
            pm_by_name[nm] = pid
            pm_by_norm[normalize_name(nm)] = pid

        cur.execute('SELECT inventory_no, id, current_status, current_location FROM equipment.inventory_items;')
        inv_by_no = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}

        # 통계
        stats = defaultdict(int)
        n_new_inv = n_upd_inv = n_tx_purchase = n_tx_transfer = n_tx_release = n_ca = 0
        unmatched_warnings = []

        SYS_USER = 'system-migration'

        def lookup_customer(name):
            if not name: return None
            if name in cust_by_name: return cust_by_name[name]
            nk = normalize_customer(name)
            return cust_by_norm.get(nk)

        def lookup_product(name):
            if not name: return None
            if name in pm_by_name: return pm_by_name[name]
            nk = normalize_name(name)
            return pm_by_norm.get(nk)

        for tx in all_tx:
            kind = tx['kind']
            inv_no = tx.get('inv_no')
            if not inv_no:
                stats['no_inv_no'] += 1
                continue

            pm_id = lookup_product(tx.get('item'))

            if kind == 'purchase':
                if inv_no not in inv_by_no:
                    # 신규 InventoryItem
                    item_id = make_id('inv')
                    tracking = 'INDIVIDUAL' if tx.get('serial') else 'BULK'
                    cur.execute("""INSERT INTO equipment.inventory_items
                        (id, inventory_no, product_master_id, serial_number, tracking_mode,
                         quantity, category, current_location, current_status,
                         total_additional_cost, total_cost_of_ownership,
                         project_name, assignee_name, item_name, manufacturer,
                         notes, created_by, created_at, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s, 'PRODUCT', %s, 'IN_STOCK',
                         0, 0, %s, %s, %s, %s, %s, %s, NOW(), NOW());""",
                       (item_id, inv_no, pm_id, tx.get('serial'), tracking,
                        tx['qty'], tx.get('warehouse'),
                        tx.get('project'), tx.get('assignee'),
                        tx.get('item'), tx.get('manufacturer'),
                        tx.get('remarks'), SYS_USER))
                    inv_by_no[inv_no] = (item_id, 'IN_STOCK', tx.get('warehouse'))
                    n_new_inv += 1
                else:
                    # 기존 InventoryItem — 정보 보강만
                    item_id, _, _ = inv_by_no[inv_no]
                    cur.execute("""UPDATE equipment.inventory_items
                                      SET item_name = COALESCE(item_name, %s),
                                          manufacturer = COALESCE(manufacturer, %s),
                                          serial_number = COALESCE(serial_number, %s),
                                          updated_at = NOW()
                                    WHERE id = %s;""",
                                (tx.get('item'), tx.get('manufacturer'),
                                 tx.get('serial'), item_id))
                    n_upd_inv += 1

                # PURCHASE 트랜잭션 기록
                cur.execute("""INSERT INTO equipment.inventory_transactions
                    (id, inventory_item_id, type, date, sequence_no, quantity,
                     to_location, project_name, assignee_name, supplier, notes,
                     created_by, created_at)
                   VALUES (%s, %s, 'PURCHASE', %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, NOW());""",
                   (make_id('tx'), inv_by_no[inv_no][0], tx['date'], tx.get('seq'),
                    tx['qty'], tx.get('warehouse'), tx.get('project'),
                    tx.get('assignee'), tx.get('supplier'),
                    tx.get('remarks'), SYS_USER))
                n_tx_purchase += 1

            elif kind == 'transfer':
                if inv_no not in inv_by_no:
                    # 4개월 외 과거 구매분 — 신규 InventoryItem 생성 (메타 nullable)
                    item_id = make_id('inv')
                    tracking = 'INDIVIDUAL' if tx.get('serial') else 'BULK'
                    cur.execute("""INSERT INTO equipment.inventory_items
                        (id, inventory_no, product_master_id, serial_number, tracking_mode,
                         quantity, category, current_location, current_status,
                         total_additional_cost, total_cost_of_ownership,
                         project_name, assignee_name, item_name, notes,
                         created_by, created_at, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s, 'PREV_PRODUCT', %s, 'IN_STOCK',
                         0, 0, %s, %s, %s, %s, %s, NOW(), NOW());""",
                       (item_id, inv_no, pm_id, tx.get('serial'), tracking,
                        tx['qty'], tx.get('to_wh') or tx.get('from_wh'),
                        tx.get('project'), tx.get('assignee'), tx.get('item'),
                        tx.get('remarks'), SYS_USER))
                    inv_by_no[inv_no] = (item_id, 'IN_STOCK', tx.get('to_wh'))
                    n_new_inv += 1

                item_id, _, _ = inv_by_no[inv_no]
                # 위치 갱신
                cur.execute("""UPDATE equipment.inventory_items
                                  SET current_location = %s, updated_at = NOW()
                                WHERE id = %s;""",
                            (tx.get('to_wh'), item_id))
                inv_by_no[inv_no] = (item_id, inv_by_no[inv_no][1], tx.get('to_wh'))

                cur.execute("""INSERT INTO equipment.inventory_transactions
                    (id, inventory_item_id, type, date, sequence_no, quantity,
                     from_location, to_location, project_name, assignee_name, notes,
                     created_by, created_at)
                   VALUES (%s, %s, 'TRANSFER', %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, NOW());""",
                   (make_id('tx'), item_id, tx['date'], tx.get('seq'), tx['qty'],
                    tx.get('from_wh'), tx.get('to_wh'), tx.get('project'),
                    tx.get('assignee'), tx.get('remarks'), SYS_USER))
                n_tx_transfer += 1

            elif kind == 'sale':
                if inv_no not in inv_by_no:
                    # 4개월 외 과거 자산 — 신규 생성
                    item_id = make_id('inv')
                    tracking = 'INDIVIDUAL' if tx.get('serial') else 'BULK'
                    cur.execute("""INSERT INTO equipment.inventory_items
                        (id, inventory_no, product_master_id, serial_number, tracking_mode,
                         quantity, category, current_location, current_status,
                         total_additional_cost, total_cost_of_ownership,
                         project_name, assignee_name, item_name, notes,
                         created_by, created_at, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s, 'PREV_PRODUCT', %s, 'RELEASED',
                         0, 0, %s, %s, %s, %s, %s, NOW(), NOW());""",
                       (item_id, inv_no, pm_id, tx.get('serial'), tracking,
                        tx['qty'], tx.get('warehouse'),
                        tx.get('project'), tx.get('assignee'), tx.get('item'),
                        tx.get('remarks'), SYS_USER))
                    inv_by_no[inv_no] = (item_id, 'RELEASED', tx.get('warehouse'))
                    n_new_inv += 1

                item_id, _, _ = inv_by_no[inv_no]
                # 상태 RELEASED로 갱신
                cur.execute("""UPDATE equipment.inventory_items
                                  SET current_status = 'RELEASED', updated_at = NOW()
                                WHERE id = %s;""", (item_id,))
                inv_by_no[inv_no] = (item_id, 'RELEASED', inv_by_no[inv_no][2])

                # CustomerAsset 생성 (소속 고객사)
                cust_id = lookup_customer(tx.get('customer'))
                if cust_id:
                    cur.execute("""INSERT INTO equipment.customer_assets
                        (id, "customerId", "assetType", name, "serialNumber",
                         "otInventoryNo", "soldAt", notes,
                         "createdAt", "updatedAt")
                       VALUES (%s, %s, 'EQUIPMENT', %s, %s, %s, %s, %s,
                               NOW(), NOW());""",
                       (make_id('ca'), cust_id, tx.get('item') or 'UNKNOWN',
                        tx.get('serial'), inv_no, tx['date'], tx.get('remarks')))
                    n_ca += 1
                else:
                    unmatched_warnings.append(f"고객사 매칭 실패: '{tx.get('customer')}' (inv_no={inv_no})")

                cur.execute("""INSERT INTO equipment.inventory_transactions
                    (id, inventory_item_id, type, date, sequence_no, quantity,
                     from_location, delivery_to, project_name, assignee_name, notes,
                     created_by, created_at)
                   VALUES (%s, %s, 'RELEASE', %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, NOW());""",
                   (make_id('tx'), item_id, tx['date'], tx.get('seq'), tx['qty'],
                    tx.get('warehouse'), tx.get('customer'), tx.get('project'),
                    tx.get('assignee'), tx.get('remarks'), SYS_USER))
                n_tx_release += 1

        # 결과
        print(f"\n=== Phase B-2 결과 ===")
        print(f"InventoryItem 신규 INSERT: {n_new_inv}")
        print(f"InventoryItem UPDATE     : {n_upd_inv}")
        print(f"PURCHASE 트랜잭션         : {n_tx_purchase}")
        print(f"TRANSFER 트랜잭션         : {n_tx_transfer}")
        print(f"RELEASE 트랜잭션          : {n_tx_release}")
        print(f"CustomerAsset 신규        : {n_ca}")
        print(f"고객사 매칭 실패 (생략)     : {len(unmatched_warnings)}")
        if unmatched_warnings:
            print(f"  상위 5건:")
            for w in unmatched_warnings[:5]:
                print(f"  - {w}")
        print(f"\ninv_no 없는 ecount row (skip): {stats.get('no_inv_no', 0)}")

        conn.commit()
        print("\n✅ COMMIT 성공.")
    except Exception as e:
        conn.rollback()
        print(f"\n❌ ERROR: {e}\n  ROLLBACK.")
        import traceback; traceback.print_exc()
    finally:
        cur.close(); conn.close()

if __name__ == '__main__':
    main()
