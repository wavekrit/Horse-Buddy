import os
import json
import random
import sqlite3
import smtplib
from email.mime.text import MIMEText
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='.')
DB_PATH = 'datauma.db'

# ==============================================================================
# 🔑 ตั้งค่าบัญชีหัวหน้าแอดมิน (Master Admin) และอีเมลสำหรับรับรหัส OTP จริง
# ==============================================================================
MASTER_ADMIN_USERNAME = "admin_hb"          # ชื่อผู้ใช้หัวหน้าแอดมิน
MASTER_ADMIN_PASSWORD = "admin12345"        # รหัสผ่านหัวหน้าแอดมิน
MASTER_ADMIN_DISPLAY_NAME = "โกชิป"         # ชื่อที่แสดงมุมขวาบนในหน้าแอดมิน

# หากต้องการส่ง OTP เข้า Gmail จริง ให้กรอกอีเมลและ App Password 16 หลักที่นี่
ADMIN_OTP_RECEIVER_EMAIL = ""
SMTP_SENDER_GMAIL = ""
SMTP_GMAIL_APP_PASSWORD = ""

ADMIN_OTP_SESSIONS = {}


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ==============================================================================
# 🛠️ สร้างและซ่อมแซมตารางทั้งหมดใน datauma.db + เติมสินค้าตั้งต้นให้ครบทุกหมวด
# ==============================================================================
def init_and_repair_db():
    conn = get_db_connection()
    cur = conn.cursor()

    # 1. ตารางผู้ใช้งาน
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            address TEXT DEFAULT '',
            avatar_url TEXT DEFAULT 'https://api.dicebear.com/7.x/bottts/svg?seed=HorseBuddy',
            role TEXT DEFAULT 'customer',
            recipient_name TEXT DEFAULT '',
            recipient_phone TEXT DEFAULT '',
            country_type TEXT DEFAULT 'ในประเทศ',
            region_text TEXT DEFAULT '',
            detail_address TEXT DEFAULT '',
            lat REAL DEFAULT 16.4419,
            lng REAL DEFAULT 102.8360,
            distance_km REAL DEFAULT 0.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    user_extra_cols = [
        ("recipient_name", "TEXT DEFAULT ''"),
        ("recipient_phone", "TEXT DEFAULT ''"),
        ("country_type", "TEXT DEFAULT 'ในประเทศ'"),
        ("region_text", "TEXT DEFAULT ''"),
        ("detail_address", "TEXT DEFAULT ''"),
        ("lat", "REAL DEFAULT 16.4419"),
        ("lng", "REAL DEFAULT 102.8360"),
        ("distance_km", "REAL DEFAULT 0.0")
    ]
    for col_name, col_def in user_extra_cols:
        try:
            cur.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}")
        except sqlite3.OperationalError:
            pass

    # 2. ตารางม้า รูปภาพม้า และตัวเลือกพ่อพันธุ์/แม่พันธุ์
    cur.execute('''
        CREATE TABLE IF NOT EXISTS horses (
            horse_id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            breed TEXT NOT NULL,
            price_range_text TEXT NOT NULL,
            description TEXT DEFAULT '',
            vaccine_info TEXT DEFAULT '',
            rating REAL DEFAULT 5.0,
            review_count INTEGER DEFAULT 2
        )
    ''')
    try:
        cur.execute("ALTER TABLE horses ADD COLUMN vaccine_info TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    cur.execute('''
        CREATE TABLE IF NOT EXISTS horse_images (
            img_id INTEGER PRIMARY KEY AUTOINCREMENT,
            horse_id TEXT NOT NULL,
            image_url TEXT NOT NULL,
            sort_order INTEGER DEFAULT 1
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS horse_variants (
            variant_id INTEGER PRIMARY KEY AUTOINCREMENT,
            horse_id TEXT NOT NULL,
            variant_type TEXT NOT NULL,
            variant_label TEXT NOT NULL,
            horse_name TEXT NOT NULL,
            age_text TEXT DEFAULT '4 ปี',
            health_status TEXT DEFAULT 'แข็งแรงสมบูรณ์',
            market_price REAL NOT NULL,
            stock INTEGER DEFAULT 1
        )
    ''')

    # 3. ตารางสินค้าทั่วไป (อาหารม้าและอุปกรณ์เสริม) พร้อมคอลัมน์ unit_name (ลักษณะนาม)
    cur.execute('''
        CREATE TABLE IF NOT EXISTS products (
            product_id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            product_name TEXT NOT NULL,
            price REAL NOT NULL,
            stock INTEGER DEFAULT 10,
            unit_name TEXT DEFAULT 'ชิ้น',
            image_url TEXT DEFAULT '',
            description TEXT DEFAULT '',
            rating REAL DEFAULT 5.0,
            review_count INTEGER DEFAULT 2
        )
    ''')
    try:
        cur.execute("ALTER TABLE products ADD COLUMN unit_name TEXT DEFAULT 'ชิ้น'")
    except sqlite3.OperationalError:
        pass

    # ปรับชื่อหมวดหมู่ในฐานข้อมูลให้ตรงมาตรฐานเดียวกันทั้งหมด ('racing', 'show', 'feed', 'equipment')
    cur.execute("UPDATE products SET category = 'feed' WHERE LOWER(category) IN ('food', 'horse_feed', 'อาหารสัตว์')")
    cur.execute("UPDATE products SET category = 'equipment' WHERE LOWER(category) IN ('accessories', 'equip', 'accessory', 'อุปกรณ์เสริม')")

    # 4. ตารางคำสั่งซื้อและรายการสินค้าในคำสั่งซื้อ
    cur.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            order_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT NOT NULL UNIQUE,
            user_id INTEGER,
            payment_method TEXT NOT NULL,
            installment_months INTEGER DEFAULT 0,
            subtotal REAL NOT NULL,
            vat_amount REAL NOT NULL,
            grand_total REAL NOT NULL,
            deposit_amount REAL NOT NULL,
            monthly_installment REAL DEFAULT 0,
            slip_image_url TEXT DEFAULT '',
            shipping_address TEXT NOT NULL,
            order_status TEXT DEFAULT 'pending_approval',
            shipping_scope TEXT DEFAULT 'ในประเทศ',
            transport_mode TEXT DEFAULT 'land',
            stall_type TEXT DEFAULT 'shared',
            distance_km REAL DEFAULT 0.0,
            shipping_cost REAL DEFAULT 0.0,
            travel_expense REAL DEFAULT 0.0,
            doc_fee REAL DEFAULT 0.0,
            insurance_fee REAL DEFAULT 0.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    order_extra_cols = [
        ("shipping_scope", "TEXT DEFAULT 'ในประเทศ'"),
        ("transport_mode", "TEXT DEFAULT 'land'"),
        ("stall_type", "TEXT DEFAULT 'shared'"),
        ("distance_km", "REAL DEFAULT 0.0"),
        ("shipping_cost", "REAL DEFAULT 0.0"),
        ("travel_expense", "REAL DEFAULT 0.0"),
        ("doc_fee", "REAL DEFAULT 0.0"),
        ("insurance_fee", "REAL DEFAULT 0.0")
    ]
    for col_name, col_def in order_extra_cols:
        try:
            cur.execute(f"ALTER TABLE orders ADD COLUMN {col_name} {col_def}")
        except sqlite3.OperationalError:
            pass

    cur.execute('''
        CREATE TABLE IF NOT EXISTS order_items (
            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            item_type TEXT NOT NULL,
            ref_id TEXT NOT NULL,
            variant_type TEXT DEFAULT '',
            item_title TEXT NOT NULL,
            unit_price REAL NOT NULL,
            quantity INTEGER NOT NULL,
            is_reviewed INTEGER DEFAULT 0
        )
    ''')

    # 5. ตารางรีวิว การแจ้งเตือนผู้ใช้ คำร้องติดต่อแอดมิน และตารางแอดมิน
    cur.execute('''
        CREATE TABLE IF NOT EXISTS reviews (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type TEXT NOT NULL,
            ref_id TEXT NOT NULL,
            reviewer_name TEXT NOT NULL,
            stars INTEGER NOT NULL,
            comment TEXT NOT NULL,
            review_date TEXT NOT NULL,
            is_admin_seen INTEGER DEFAULT 1,
            is_hidden INTEGER DEFAULT 0
        )
    ''')
    for col_name, col_def in [("is_admin_seen", "INTEGER DEFAULT 1"), ("is_hidden", "INTEGER DEFAULT 0")]:
        try:
            cur.execute(f"ALTER TABLE reviews ADD COLUMN {col_name} {col_def}")
        except sqlite3.OperationalError:
            pass

    cur.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            notif_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_number TEXT DEFAULT '',
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS support_requests (
            request_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            current_username TEXT,
            current_email TEXT,
            reason TEXT NOT NULL,
            details TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS admins (
            admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            email TEXT DEFAULT '',
            avatar_url TEXT DEFAULT 'https://api.dicebear.com/7.x/adventurer/svg?seed=Gochip',
            permissions TEXT DEFAULT 'all',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS admin_notifications (
            admin_notif_id INTEGER PRIMARY KEY AUTOINCREMENT,
            notif_type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            ref_id TEXT DEFAULT '',
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cur.execute('''
        INSERT OR IGNORE INTO admins (username, password_hash, display_name, email, permissions)
        VALUES (?, ?, ?, ?, 'all')
    ''', (MASTER_ADMIN_USERNAME, MASTER_ADMIN_PASSWORD, MASTER_ADMIN_DISPLAY_NAME, ADMIN_OTP_RECEIVER_EMAIL or 'admin@horsebuddy.com'))

    # 6. เติมข้อมูลม้าทั้ง 2 หมวด (RACING HORSE 4 ตัว + SHOW HORSE 4 ตัว) หากตัวใดยังไม่มีในตาราง
    default_vaccine = "วัคซีนไข้หวัดม้า (Equine Influenza), วัคซีนโรคบาดทะยัก (Tetanus), วัคซีนโรคเยื่อหุ้มสมองอักเสบ (JE), วัคซีนโรคพิษสุนัขบ้า (Rabies)"
    default_horses = [
        ("h-racing-1", "racing", "AMERICAN QUARTER HORSE", "52,000 - 1,225,000 ฿",
         "ม้าวิ่งระยะสั้นที่เร็วที่สุดในโลก กล้ามเนื้อแข็งแรง ออกตัวไว ควบคุมง่าย เหมาะสำหรับงานแข่งความเร็ว",
         "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?auto=format&fit=crop&w=900&q=80",
         ("Quarter Blaze (ควอเตอร์ เบลซ)", "4 ปี", 650000, 2), ("Golden Dash (โกลเด้น แดช)", "3 ปี", 580000, 2)),
        ("h-racing-2", "racing", "ORLOV TROTTER", "52,000 - 700,000 ฿",
         "สายพันธุ์ม้าวิ่งเหยาะระดับตำนานจากรัสเซีย ท่วงท่าสง่างาม ความอึดสูง วิ่งทางไกลได้อย่างมั่นคง",
         "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?auto=format&fit=crop&w=900&q=80",
         ("Silver Snow (ซิลเวอร์ สโนว์)", "4 ปี", 480000, 2), ("White Grace (ไวท์ เกรซ)", "3 ปี", 420000, 2)),
        ("h-racing-3", "racing", "THOROUGHBRED", "175,000 - 17,500,000+ ฿",
         "สุดยอดม้าแข่งความเร็วสูงระดับโลก ปราดเปรียว พลังงานสูง ช่วงขายาวก้าวกระโดดทรงพลัง",
         "https://images.unsplash.com/photo-1534773728080-33d31da27ae5?auto=format&fit=crop&w=900&q=80",
         ("Black Kaiser (แบล็ค ไคเซอร์)", "4 ปี", 4500000, 1), ("Shadow Queen (ชาโดว์ ควีน)", "3 ปี", 3900000, 2)),
        ("h-racing-4", "racing", "STANDARDDBRED PACER", "140,000 - 3,500,000+ ฿",
         "ม้าแข่งความเร็วทางเรียบสายพันธุ์แกร่ง กล้ามเนื้อขาแข็งแรง ฝึกสอนง่ายและทนทานสูง",
         "https://images.unsplash.com/photo-1566251037378-5e04e3bec343?auto=format&fit=crop&w=900&q=80",
         ("Thunder Bolt (ธันเดอร์ โบลต์)", "4 ปี", 1250000, 2), ("Wind Runner (วินด์ รันเนอร์)", "3 ปี", 980000, 2)),
        ("h-show-1", "show", "DUTCH WARMBLOOD", "950,000 - 3,500,000 ฿",
         "ม้ากีฬาและม้าโชว์ศิลปะการบังคับม้าระดับโอลิมปิก นิสัยฉลาด สุขุม ท่วงท่าการก้าวเดินสง่างาม",
         "https://images.unsplash.com/photo-1566251037378-5e04e3bec343?auto=format&fit=crop&w=900&q=80",
         ("Apollo Gold (อพอลโล โกลด์)", "5 ปี", 1850000, 2), ("Diana Rose (ไดอาน่า โรส)", "4 ปี", 1650000, 2)),
        ("h-show-2", "show", "ARABIAN HORSE", "800,000 - 5,000,000 ฿",
         "หนึ่งในสายพันธุ์ม้าที่เก่าแก่และสวยงามที่สุดในโลก โครงหน้าเว้าเป็นเอกลักษณ์ คอโค้งระหง",
         "https://images.unsplash.com/photo-1551884831-bbf3cdc6469e?auto=format&fit=crop&w=900&q=80",
         ("Desert Prince (เดเซิร์ท พรินซ์)", "4 ปี", 2200000, 1), ("Mirage Star (มิราจ สตาร์)", "3 ปี", 1950000, 2)),
        ("h-show-3", "show", "FRIESIAN HORSE", "1,200,000 - 4,800,000 ฿",
         "ม้าสีดำสนิทปลอดทั้งตัวจากเนเธอร์แลนด์ แผงคอและหางยาวสลวยเป็นคลื่น สง่างามดั่งม้าอัศวิน",
         "https://images.unsplash.com/photo-1511994714008-b6d68a8b32a2?auto=format&fit=crop&w=900&q=80",
         ("Midnight Knight (มิดไนท์ ไนท์)", "5 ปี", 2600000, 1), ("Obsidian Belle (ออบซิเดียน เบลล์)", "4 ปี", 2400000, 1)),
        ("h-show-4", "show", "ANDALUSIAN HORSE", "900,000 - 4,200,000 ฿",
         "ม้าสายพันธุ์สเปนโบราณ ขนสีขาวเทาเงิน ท่วงท่าการยกขาสูงสง่างาม เหมาะสำหรับงานโชว์ระดับสูง",
         "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?auto=format&fit=crop&w=900&q=80",
         ("Royal Madrid (รอยัล มาดริด)", "5 ปี", 2100000, 2), ("Luna Blanca (ลูน่า บลังก้า)", "4 ปี", 1900000, 2))
    ]

    for hid, cat, breed, prange, desc, img_url, sire_info, dam_info in default_horses:
        exists = cur.execute('SELECT 1 FROM horses WHERE horse_id = ?', (hid,)).fetchone()
        if not exists:
            cur.execute('''
                INSERT INTO horses (horse_id, category, breed, price_range_text, description, vaccine_info, rating, review_count)
                VALUES (?, ?, ?, ?, ?, ?, 5.0, 2)
            ''', (hid, cat, breed, prange, desc, default_vaccine))
            cur.execute('INSERT INTO horse_images (horse_id, image_url, sort_order) VALUES (?, ?, 1)', (hid, img_url))
            cur.execute('''
                INSERT INTO horse_variants (horse_id, variant_type, variant_label, horse_name, age_text, health_status, market_price, stock)
                VALUES (?, 'sire', 'พ่อพันธุ์', ?, ?, 'แข็งแรงสมบูรณ์ (ตรวจสุขภาพแล้ว)', ?, ?)
            ''', (hid, sire_info[0], sire_info[1], sire_info[2], sire_info[3]))
            cur.execute('''
                INSERT INTO horse_variants (horse_id, variant_type, variant_label, horse_name, age_text, health_status, market_price, stock)
                VALUES (?, 'dam', 'แม่พันธุ์', ?, ?, 'แข็งแรงสมบูรณ์ (ตรวจสุขภาพแล้ว)', ?, ?)
            ''', (hid, dam_info[0], dam_info[1], dam_info[2], dam_info[3]))

    # 7. เติมข้อมูลสินค้าทั่วไป (อาหารสัตว์ 4 รายการ + อุปกรณ์เสริม 4 รายการ)
    default_products = [
        ("p-feed-1", "feed", "หญ้าอัลฟัลฟ่าอัดก้อนเกรดพรีเมียม (Alfalfa Hay 25 kg)", 1450, 25, "ก้อน",
         "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80",
         "หญ้าอัลฟัลฟ่านำเข้า โปรตีนและแคลเซียมสูง กลิ่นหอม ไร้ฝุ่น เหมาะสำหรับม้าแข่งและม้าพ่อแม่พันธุ์"),
        ("p-feed-2", "feed", "อาหารเม็ดผสมวิตามินสำหรับม้าแข่ง (Champion Pellet 30 kg)", 1890, 14, "กระสอบ",
         "https://images.unsplash.com/photo-1589923188900-85dae523342b?auto=format&fit=crop&w=800&q=80",
         "สูตรเพิ่มพลังงานและกล้ามเนื้อ ย่อยง่าย เสริมสร้างความทนทานและฟื้นฟูร่างกายหลังวิ่ง"),
        ("p-feed-3", "feed", "ก้อนเกลือแร่หิมาลัยสำหรับม้าเลีย (Himalayan Salt Lick 5 kg)", 590, 39, "ก้อน",
         "https://images.unsplash.com/photo-1518843875459-f738682238a6?auto=format&fit=crop&w=800&q=80",
         "เกลือแร่ธรรมชาติบริสุทธิ์พร้อมเชือกแขวนในคอก ช่วยเสริมแร่ธาตุที่สูญเสียไปกับเหงื่อ"),
        ("p-feed-4", "feed", "น้ำมันบำรุงขนและข้อต่อม้าสวยงาม (Omega Coat Oil 5L)", 2350, 18, "แกลลอน",
         "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=800&q=80",
         "น้ำมันสกัดเย็นอุดมด้วยโอเมก้า 3 และ 6 ช่วยให้ขนม้าเงางามเป็นประกายและบำรุงข้อต่อ"),
        ("p-equip-1", "equipment", "อานม้าหนังแท้แฮนด์เมด (Pro Leather Saddle)", 28500, 8, "ชุด",
         "https://images.unsplash.com/photo-1511994714008-b6d68a8b32a2?auto=format&fit=crop&w=800&q=80",
         "อานม้าหนังวัวแท้เกรดพรีเมียม ออกแบบตามสรีรศาสตร์ ลดแรงกระแทกหลังม้าและนั่งสบาย"),
        ("p-equip-2", "equipment", "สนับแข้งม้ากันกระแทก (Carbon Tendon Boots)", 3400, 20, "คู่",
         "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?auto=format&fit=crop&w=800&q=80",
         "สนับแข้งคาร์บอนไฟเบอร์ซับในนีโอพรีน ป้องกันเส้นเอ็นและข้อเท้าม้าระหว่างฝึกซ้อมหรือขนส่ง"),
        ("p-equip-3", "equipment", "ขลุ่ยปากและบังเหียนหนังแท้ (Classic Leather Bridle)", 4900, 15, "ชุด",
         "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?auto=format&fit=crop&w=800&q=80",
         "ชุดบังเหียนหนังแท้บุฟองน้ำนุ่มพิเศษ ไม่เสียดสีใบหน้าม้า พร้อมเหล็กรองปากสแตนเลสแท้"),
        ("p-equip-4", "equipment", "ชุดแปรงขนและดูแลกีบม้า 8 ชิ้น (Master Grooming Kit)", 1950, 22, "กล่อง",
         "https://images.unsplash.com/photo-1534773728080-33d31da27ae5?auto=format&fit=crop&w=800&q=80",
         "ชุดอุปกรณ์แปรงขนม้า แปรงหวีแผงคอ และที่แคะกีบม้าครบชุด พร้อมกระเป๋าเก็บพกพา")
    ]

    for pid, cat, name, price, stock, unit, img, desc in default_products:
        cur.execute('''
            INSERT OR IGNORE INTO products (product_id, category, product_name, price, stock, unit_name, image_url, description, rating, review_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5.0, 2)
        ''', (pid, cat, name, price, stock, unit, img, desc))

    conn.commit()
    conn.close()


init_and_repair_db()


def build_user_dict(user_row):
    keys = user_row.keys()
    return {
        "user_id": user_row['user_id'],
        "username": user_row['username'],
        "email": user_row['email'],
        "phone": user_row['phone'],
        "password": user_row['password_hash'],
        "address": user_row['address'] or '',
        "avatar": user_row['avatar_url'] or 'https://api.dicebear.com/7.x/bottts/svg?seed=HorseBuddy',
        "role": user_row['role'] if 'role' in keys else 'customer',
        "recipient_name": user_row['recipient_name'] if 'recipient_name' in keys and user_row['recipient_name'] else user_row['username'],
        "recipient_phone": user_row['recipient_phone'] if 'recipient_phone' in keys and user_row['recipient_phone'] else user_row['phone'],
        "country_type": user_row['country_type'] if 'country_type' in keys and user_row['country_type'] else 'ในประเทศ',
        "region_text": user_row['region_text'] if 'region_text' in keys and user_row['region_text'] else '',
        "detail_address": user_row['detail_address'] if 'detail_address' in keys and user_row['detail_address'] else (user_row['address'] or ''),
        "lat": float(user_row['lat']) if 'lat' in keys and user_row['lat'] is not None else 16.4419,
        "lng": float(user_row['lng']) if 'lng' in keys and user_row['lng'] is not None else 102.8360,
        "distance_km": float(user_row['distance_km']) if 'distance_km' in keys and user_row['distance_km'] is not None else 0.0
    }


# ==============================================================================
# 🌐 เส้นทางเปิดหน้าเว็บหลัก (ma.html) และหน้าแอดมิน (admin.html)
# ==============================================================================
@app.route('/')
def index():
    return send_from_directory('.', 'ma.html')


@app.route('/admin')
def serve_admin_page():
    return send_from_directory('.', 'admin.html')


# ==============================================================================
# 📦 API ดึงข้อมูลม้าและสินค้าทั้งหมด (ส่งให้ทั้งหน้าผู้ใช้งานและหน้าแอดมิน)
# ==============================================================================
@app.route('/api/data', methods=['GET'])
def get_all_data():
    conn = get_db_connection()

    horses_rows = conn.execute('SELECT * FROM horses').fetchall()
    horses_data = []
    for h in horses_rows:
        h_keys = h.keys()
        hid = h['horse_id']

        imgs = [row['image_url'] for row in conn.execute(
            'SELECT image_url FROM horse_images WHERE horse_id = ? ORDER BY sort_order ASC', (hid,)
        ).fetchall()]
        if not imgs:
            imgs = ["https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?auto=format&fit=crop&w=900&q=80"]

        variants_rows = conn.execute('SELECT * FROM horse_variants WHERE horse_id = ?', (hid,)).fetchall()
        variants_dict = {}
        for v in variants_rows:
            variants_dict[v['variant_type']] = {
                "label": v['variant_label'],
                "horseName": v['horse_name'],
                "age": v['age_text'],
                "health": v['health_status'],
                "price": float(v['market_price']),
                "stock": int(v['stock'])
            }

        if 'sire' not in variants_dict:
            variants_dict['sire'] = {
                "label": "พ่อพันธุ์", "horseName": f"{h['breed']} (Sire)",
                "age": "4 ปี", "health": "แข็งแรงสมบูรณ์", "price": 250000, "stock": 1
            }
        if 'dam' not in variants_dict:
            variants_dict['dam'] = {
                "label": "แม่พันธุ์", "horseName": f"{h['breed']} (Dam)",
                "age": "3 ปี", "health": "แข็งแรงสมบูรณ์", "price": 230000, "stock": 1
            }

        revs_rows = conn.execute(
            'SELECT reviewer_name as user, stars, comment, review_date as date FROM reviews WHERE item_type = "horse" AND ref_id = ? AND is_hidden = 0 ORDER BY review_id DESC',
            (hid,)
        ).fetchall()

        horses_data.append({
            "id": hid,
            "category": h['category'],
            "breed": h['breed'],
            "priceRange": h['price_range_text'],
            "rating": float(h['rating']) if 'rating' in h_keys and h['rating'] else 5.0,
            "reviewCount": int(h['review_count']) if 'review_count' in h_keys and h['review_count'] else 1,
            "images": imgs,
            "description": h['description'] or '',
            "vaccineInfo": h['vaccine_info'] if 'vaccine_info' in h_keys and h['vaccine_info'] else '',
            "variants": variants_dict,
            "reviews": [dict(r) for r in revs_rows]
        })

    products_rows = conn.execute('SELECT * FROM products').fetchall()
    other_products_data = []
    for p in products_rows:
        p_keys = p.keys()
        pid = p['product_id']
        unit_name = p['unit_name'] if ('unit_name' in p_keys and p['unit_name']) else 'ชิ้น'

        revs_rows = conn.execute(
            'SELECT reviewer_name as user, stars, comment, review_date as date FROM reviews WHERE item_type = "other" AND ref_id = ? AND is_hidden = 0 ORDER BY review_id DESC',
            (pid,)
        ).fetchall()

        other_products_data.append({
            "id": pid,
            "category": p['category'],
            "name": p['product_name'],
            "price": float(p['price']),
            "stock": int(p['stock']),
            "unit": unit_name,
            "rating": float(p['rating']) if 'rating' in p_keys and p['rating'] else 5.0,
            "reviewCount": int(p['review_count']) if 'review_count' in p_keys and p['review_count'] else 1,
            "image": p['image_url'] or '',
            "description": p['description'] or '',
            "reviews": [dict(r) for r in revs_rows]
        })

    conn.close()
    resp = jsonify({
        "horsesData": horses_data,
        "otherProductsData": other_products_data
    })
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


# ==============================================================================
# 👤 API สมาชิก การเข้าสู่ระบบ และจัดการโปรไฟล์ผู้ใช้
# ==============================================================================
@app.route('/api/register', methods=['POST'])
def register_user():
    req = request.json or {}
    username = req.get('username', '').strip()
    email = req.get('email', '').strip().lower()
    phone = req.get('phone', '').strip()
    password = req.get('password', '')
    address = req.get('address', '').strip()
    avatar = req.get('avatar') or f"https://api.dicebear.com/7.x/bottts/svg?seed={username}"

    conn = get_db_connection()
    if conn.execute('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)', (username,)).fetchone():
        conn.close()
        return jsonify({"ok": False, "field": "username", "message": "ชื่อผู้ใช้นี้มีในระบบแล้ว"}), 400
    if conn.execute('SELECT 1 FROM users WHERE LOWER(email) = ?', (email,)).fetchone():
        conn.close()
        return jsonify({"ok": False, "field": "email", "message": "อีเมลนี้ถูกใช้งานแล้ว"}), 400
    if conn.execute('SELECT 1 FROM users WHERE phone = ?', (phone,)).fetchone():
        conn.close()
        return jsonify({"ok": False, "field": "phone", "message": "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว"}), 400

    cur = conn.cursor()
    cur.execute('''
        INSERT INTO users (username, email, phone, password_hash, address, avatar_url, recipient_name, recipient_phone, detail_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (username, email, phone, password, address, avatar, username, phone, address))
    conn.commit()
    user_row = conn.execute('SELECT * FROM users WHERE user_id = ?', (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "user": build_user_dict(user_row)})


@app.route('/api/login', methods=['POST'])
def login_user():
    req = request.json or {}
    identifier = req.get('email', '').strip()
    password = req.get('password', '')

    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) AND password_hash = ?',
        (identifier, identifier, password)
    ).fetchone()
    conn.close()

    if not user:
        return jsonify({"ok": False, "message": "Username หรือ Password ไม่ถูกต้อง"}), 401
    return jsonify({"ok": True, "user": build_user_dict(user)})


# ฟังก์ชันช่วยค้นหาผู้ใช้จาก user_id, email หรือ username พร้อมกู้คืนบัญชีเข้า DB อัตโนมัติหากมีค้างใน localStorage
def find_or_restore_user_row(conn, user_id=None, email='', username='', phone='', password='', avatar=''):
    cur = conn.cursor()
    user = None

    if user_id:
        user = cur.execute('SELECT * FROM users WHERE user_id = ?', (user_id,)).fetchone()
    if not user and email:
        user = cur.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', (email,)).fetchone()
    if not user and username:
        user = cur.execute('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', (username,)).fetchone()

    # หากไม่พบใน DB เลย (เช่น บัญชีค้างในเบราว์เซอร์ก่อนรีเซ็ต DB) ให้ซิงค์สร้างกลับเข้าตาราง users อัตโนมัติ
    if not user and (email or username):
        safe_uname = username or email.split('@')[0] or f"user_{random.randint(1000, 9999)}"
        safe_email = email or f"{safe_uname}@gmail.com"
        safe_phone = phone or f"08{random.randint(10000000, 99999999)}"
        safe_pass = password or "123456"
        safe_avatar = avatar or f"https://api.dicebear.com/7.x/bottts/svg?seed={safe_uname}"

        # ป้องกันกรณีเบอร์โทรชนกับคนอื่นตอนกู้คืน
        if cur.execute('SELECT 1 FROM users WHERE phone = ?', (safe_phone,)).fetchone():
            safe_phone = f"08{random.randint(10000000, 99999999)}"

        try:
            cur.execute('''
                INSERT INTO users (username, email, phone, password_hash, avatar_url, recipient_name, recipient_phone)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (safe_uname, safe_email, safe_phone, safe_pass, safe_avatar, safe_uname, safe_phone))
            conn.commit()
            user = cur.execute('SELECT * FROM users WHERE user_id = ?', (cur.lastrowid,)).fetchone()
        except sqlite3.IntegrityError:
            user = cur.execute(
                'SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)',
                (safe_email, safe_uname)
            ).fetchone()

    return user


@app.route('/api/profile/full', methods=['GET'])
def get_full_profile():
    email = (request.args.get('email') or '').strip().lower()
    username = (request.args.get('username') or '').strip()
    user_id = request.args.get('user_id')

    conn = get_db_connection()
    user = find_or_restore_user_row(conn, user_id=user_id, email=email, username=username)
    conn.close()
    if not user:
        return jsonify({"ok": False}), 404
    return jsonify({"ok": True, "user": build_user_dict(user)})


@app.route('/api/profile/avatar', methods=['PUT'])
def update_profile_avatar():
    req = request.json or {}
    email = (req.get('email') or '').strip().lower()
    username = (req.get('username') or '').strip()
    user_id = req.get('user_id')
    avatar = req.get('avatar', '')

    conn = get_db_connection()
    user = find_or_restore_user_row(conn, user_id=user_id, email=email, username=username, avatar=avatar)
    if not user:
        conn.close()
        return jsonify({"ok": False, "message": "ไม่พบบัญชีผู้ใช้งาน"}), 404

    conn.execute('UPDATE users SET avatar_url = ? WHERE user_id = ?', (avatar, user['user_id']))
    conn.commit()
    updated_user = conn.execute('SELECT * FROM users WHERE user_id = ?', (user['user_id'],)).fetchone()
    conn.close()
    return jsonify({"ok": True, "user": build_user_dict(updated_user)})


@app.route('/api/profile/security', methods=['PUT'])
def update_profile_security():
    req = request.json or {}
    user_id = req.get('userId')
    old_email = (req.get('oldEmail') or '').strip().lower()
    old_username = (req.get('oldUsername') or '').strip()
    new_username = (req.get('username') or '').strip()
    new_phone = (req.get('phone') or '').strip()
    new_email = (req.get('email') or '').strip().lower()
    new_password = req.get('password', '')

    conn = get_db_connection()
    user = find_or_restore_user_row(
        conn,
        user_id=user_id,
        email=old_email or new_email,
        username=old_username or new_username,
        phone=new_phone,
        password=new_password
    )
    if not user:
        conn.close()
        return jsonify({"ok": False, "message": "ไม่พบบัญชีผู้ใช้งาน"}), 404

    target_uid = user['user_id']

    if conn.execute('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND user_id != ?', (new_username, target_uid)).fetchone():
        conn.close()
        return jsonify({"ok": False, "message": "ชื่อผู้ใช้งาน (USERNAME) นี้ถูกใช้งานแล้ว"}), 400
    if conn.execute('SELECT 1 FROM users WHERE phone = ? AND user_id != ?', (new_phone, target_uid)).fetchone():
        conn.close()
        return jsonify({"ok": False, "message": "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว"}), 400
    if conn.execute('SELECT 1 FROM users WHERE LOWER(email) = ? AND user_id != ?', (new_email, target_uid)).fetchone():
        conn.close()
        return jsonify({"ok": False, "message": "GMAIL นี้ถูกใช้งานแล้ว"}), 400

    conn.execute('''
        UPDATE users
        SET username = ?, phone = ?, email = ?, password_hash = ?
        WHERE user_id = ?
    ''', (new_username, new_phone, new_email, new_password, target_uid))
    conn.commit()

    updated_user = conn.execute('SELECT * FROM users WHERE user_id = ?', (target_uid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "user": build_user_dict(updated_user)})


@app.route('/api/profile/address', methods=['PUT'])
def update_profile_address():
    req = request.json or {}
    user_id = req.get('userId')
    email = (req.get('email') or '').strip().lower()
    username = (req.get('username') or '').strip()
    recipient_name = (req.get('recipientName') or '').strip()
    recipient_phone = (req.get('recipientPhone') or '').strip()
    country_type = (req.get('countryType') or 'ในประเทศ').strip()
    region_text = (req.get('regionText') or '').strip()
    detail_address = (req.get('detailAddress') or '').strip()
    lat = float(req.get('lat', 16.4419))
    lng = float(req.get('lng', 102.8360))
    distance_km = float(req.get('distanceKm', 0.0))

    full_address_str = f"{recipient_name} ({recipient_phone}) [{country_type}] {detail_address} {region_text} (ระยะทางจากขอนแก่น {distance_km:.1f} กม.)"

    conn = get_db_connection()
    user = find_or_restore_user_row(conn, user_id=user_id, email=email, username=username or recipient_name, phone=recipient_phone)
    if not user:
        conn.close()
        return jsonify({"ok": False, "message": "ไม่พบบัญชีผู้ใช้งาน"}), 404

    conn.execute('''
        UPDATE users
        SET recipient_name = ?, recipient_phone = ?, country_type = ?,
            region_text = ?, detail_address = ?, lat = ?, lng = ?,
            distance_km = ?, address = ?
        WHERE user_id = ?
    ''', (
        recipient_name, recipient_phone, country_type,
        region_text, detail_address, lat, lng,
        distance_km, full_address_str, user['user_id']
    ))
    conn.commit()

    updated_user = conn.execute('SELECT * FROM users WHERE user_id = ?', (user['user_id'],)).fetchone()
    conn.close()
    return jsonify({"ok": True, "user": build_user_dict(updated_user)})


@app.route('/api/support-requests', methods=['POST'])
def create_support_request():
    req = request.json or {}
    email = req.get('email', '').strip().lower()
    reason = req.get('reason', '').strip()
    details = req.get('details', '').strip()

    conn = get_db_connection()
    user = conn.execute('SELECT user_id, username FROM users WHERE LOWER(email) = ?', (email,)).fetchone()
    user_id = user['user_id'] if user else None
    username = user['username'] if user else 'ไม่ระบุ'

    cur = conn.cursor()
    cur.execute('''
        INSERT INTO support_requests (user_id, current_username, current_email, reason, details, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    ''', (user_id, username, email, reason, details))
    req_id = cur.lastrowid

    cur.execute('''
        INSERT INTO admin_notifications (notif_type, title, message, ref_id)
        VALUES ('issue', ?, ?, ?)
    ''', (
        f"แจ้งปัญหาบัญชี: {username}",
        f"สาเหตุ: {reason} ({details})",
        f"SUP-{req_id}"
    ))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ==============================================================================
# 🛒 API คำสั่งซื้อ การแจ้งเตือนฝั่งผู้ใช้ และรีวิวสินค้า
# ==============================================================================
# ตรวจสอบและซ่อมแซมคอลัมน์ตาราง orders / order_items ให้ครบถ้วนเสมอ
def ensure_orders_schema_complete():
    conn = get_db_connection()
    cur = conn.cursor()
    order_cols = [
        ("customer_username", "TEXT DEFAULT ''"),
        ("customer_email", "TEXT DEFAULT ''"),
        ("customer_phone", "TEXT DEFAULT ''"),
        ("payment_method", "TEXT DEFAULT 'qr'"),
        ("installment_months", "INTEGER DEFAULT 0"),
        ("subtotal", "REAL DEFAULT 0"),
        ("vat_amount", "REAL DEFAULT 0"),
        ("grand_total", "REAL DEFAULT 0"),
        ("deposit_amount", "REAL DEFAULT 0"),
        ("monthly_installment", "REAL DEFAULT 0"),
        ("slip_image_url", "TEXT DEFAULT ''"),
        ("shipping_address", "TEXT DEFAULT ''"),
        ("order_status", "TEXT DEFAULT 'pending_approval'"),
        ("shipping_scope", "TEXT DEFAULT 'ในประเทศ'"),
        ("transport_mode", "TEXT DEFAULT 'land'"),
        ("stall_type", "TEXT DEFAULT 'shared'"),
        ("distance_km", "REAL DEFAULT 0.0"),
        ("shipping_cost", "REAL DEFAULT 0.0"),
        ("travel_expense", "REAL DEFAULT 0.0"),
        ("doc_fee", "REAL DEFAULT 0.0"),
        ("insurance_fee", "REAL DEFAULT 0.0"),
        ("cancel_reason", "TEXT DEFAULT ''"),
        ("refund_bank_info", "TEXT DEFAULT ''"),
        ("previous_status", "TEXT DEFAULT 'pending_approval'")
    ]
    for col_name, col_def in order_cols:
        try:
            cur.execute(f"ALTER TABLE orders ADD COLUMN {col_name} {col_def}")
        except sqlite3.OperationalError:
            pass

    item_cols = [
        ("item_type", "TEXT DEFAULT 'other'"),
        ("ref_id", "TEXT DEFAULT ''"),
        ("variant_type", "TEXT DEFAULT ''"),
        ("item_title", "TEXT DEFAULT ''"),
        ("unit_price", "REAL DEFAULT 0"),
        ("quantity", "INTEGER DEFAULT 1"),
        ("is_reviewed", "INTEGER DEFAULT 0")
    ]
    for col_name, col_def in item_cols:
        try:
            cur.execute(f"ALTER TABLE order_items ADD COLUMN {col_name} {col_def}")
        except sqlite3.OperationalError:
            pass

    conn.commit()
    conn.close()


ensure_orders_schema_complete()


@app.route('/api/orders', methods=['POST'])
def create_order():
    req = request.json or {}
    user_email = (req.get('userEmail') or '').strip().lower()
    req_username = (req.get('username') or '').strip()
    req_phone = (req.get('phone') or '').strip()

    conn = get_db_connection()
    cur = conn.cursor()

    user_row = cur.execute(
        'SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR (username != "" AND LOWER(username) = LOWER(?))',
        (user_email, req_username)
    ).fetchone()

    # หากผู้ใช้ล็อกอินค้างจาก localStorage แต่ยังไม่มีชื่อในตาราง users ให้สร้างให้อัตโนมัติเพื่อไม่ให้ออเดอร์หลุด
    if not user_row and (user_email or req_username):
        safe_uname = req_username or user_email.split('@')[0] or f"user_{random.randint(1000,9999)}"
        safe_email = user_email or f"{safe_uname}@gmail.com"
        safe_phone = req_phone or f"08{random.randint(10000000, 99999999)}"
        try:
            cur.execute('''
                INSERT INTO users (username, email, phone, password_hash, address)
                VALUES (?, ?, ?, '123456', ?)
            ''', (safe_uname, safe_email, safe_phone, req.get('shippingAddress', '')))
            conn.commit()
            user_row = cur.execute('SELECT * FROM users WHERE user_id = ?', (cur.lastrowid,)).fetchone()
        except Exception:
            user_row = cur.execute('SELECT * FROM users ORDER BY user_id ASC LIMIT 1').fetchone()

    user_id = user_row['user_id'] if user_row else 1
    username = user_row['username'] if user_row else (req_username or 'ลูกค้า')
    customer_email = user_row['email'] if user_row else user_email
    customer_phone = user_row['phone'] if user_row else req_phone

    order_number = "HB-" + str(random.randint(100000, 999999))

    cur.execute('''
        INSERT INTO orders (
            order_number, user_id, customer_username, customer_email, customer_phone,
            payment_method, installment_months, subtotal, vat_amount, grand_total,
            deposit_amount, monthly_installment, slip_image_url, shipping_address,
            order_status, shipping_scope, transport_mode, stall_type, distance_km,
            shipping_cost, travel_expense, doc_fee, insurance_fee
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        order_number,
        user_id,
        username,
        customer_email,
        customer_phone,
        req.get('paymentMethod', 'qr'),
        int(req.get('installmentMonths', 0)),
        float(req.get('subtotal', 0)),
        float(req.get('vat', 0)),
        float(req.get('grandTotal', 0)),
        float(req.get('paidNow', 0)),
        float(req.get('monthlyInstallment', 0)),
        req.get('slipImage', 'uploaded_slip.jpg'),
        req.get('shippingAddress', ''),
        req.get('shippingScope', 'ในประเทศ'),
        req.get('transportMode', 'land'),
        req.get('stallType', 'shared'),
        float(req.get('distanceKm', 0.0)),
        float(req.get('shippingCost', 0.0)),
        float(req.get('travelExpense', 0.0)),
        float(req.get('docFee', 0.0)),
        float(req.get('insuranceFee', 0.0))
    ))
    order_id = cur.lastrowid

    for item in req.get('items', []):
        cur.execute('''
            INSERT INTO order_items (order_id, item_type, ref_id, variant_type, item_title, unit_price, quantity, is_reviewed)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ''', (
            order_id,
            item.get('type', 'other'),
            item.get('refId', ''),
            item.get('variantKey', ''),
            item.get('title', ''),
            float(item.get('price', 0)),
            int(item.get('qty', 1))
        ))

        if item.get('type') == 'horse':
            cur.execute('''
                UPDATE horse_variants SET stock = MAX(0, stock - ?) WHERE horse_id = ? AND variant_type = ?
            ''', (int(item.get('qty', 1)), item.get('refId'), item.get('variantKey')))
        else:
            cur.execute('''
                UPDATE products SET stock = MAX(0, stock - ?) WHERE product_id = ?
            ''', (int(item.get('qty', 1)), item.get('refId')))

    cur.execute('''
        INSERT INTO notifications (user_id, order_number, title, message, is_read)
        VALUES (?, ?, ?, ?, 0)
    ''', (
        user_id,
        order_number,
        f"รับคำสั่งซื้อ {order_number} เรียบร้อยแล้ว",
        "ระบบได้รับหลักฐานการชำระเงินของคุณแล้ว ขณะนี้อยู่ระหว่างรอแอดมินตรวจสอบและอนุมัติคำสั่งซื้อ"
    ))

    cur.execute('''
        INSERT INTO admin_notifications (notif_type, title, message, ref_id)
        VALUES ('order', ?, ?, ?)
    ''', (
        f"คำสั่งซื้อใหม่ {order_number}",
        f"ลูกค้า {username} สั่งซื้อสินค้ายอดสุทธิ {float(req.get('grandTotal', 0)):,.0f} ฿",
        order_number
    ))

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "orderNumber": order_number, "orderId": order_id})


@app.route('/api/orders', methods=['GET'])
def get_user_orders():
    email = (request.args.get('email') or '').strip().lower()
    username = (request.args.get('username') or '').strip().lower()

    conn = get_db_connection()
    user = conn.execute(
        'SELECT user_id, username, email FROM users WHERE LOWER(email) = ? OR (username != "" AND LOWER(username) = ?)',
        (email, username)
    ).fetchone()

    user_id = user['user_id'] if user else -1

    orders_rows = conn.execute('''
        SELECT * FROM orders
        WHERE user_id = ?
           OR (customer_email != '' AND LOWER(customer_email) = ?)
           OR (customer_username != '' AND LOWER(customer_username) = ?)
        ORDER BY order_id DESC
    ''', (user_id, email, username)).fetchall()

    orders_list = []
    for o in orders_rows:
        o_keys = o.keys()
        items_rows = conn.execute('SELECT * FROM order_items WHERE order_id = ?', (o['order_id'],)).fetchall()
        orders_list.append({
            "orderId": o['order_id'],
            "orderNumber": o['order_number'],
            "paymentMethod": o['payment_method'],
            "grandTotal": o['grand_total'],
            "shippingAddress": o['shipping_address'],
            "status": o['order_status'],
            "cancelReason": o['cancel_reason'] if 'cancel_reason' in o_keys else '',
            "refundBankInfo": o['refund_bank_info'] if 'refund_bank_info' in o_keys else '',
            "createdAt": o['created_at'],
            "items": [{
                "itemId": i['item_id'],
                "type": i['item_type'],
                "refId": i['ref_id'],
                "variantKey": i['variant_type'],
                "title": i['item_title'],
                "price": i['unit_price'],
                "qty": i['quantity'],
                "isReviewed": bool(i['is_reviewed'])
            } for i in items_rows]
        })
    conn.close()
    resp = jsonify({"orders": orders_list})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


# API สำหรับลูกค้ากดขอยกเลิกคำสั่งซื้อและขอคืนเงิน (ใช้ได้เฉพาะก่อนสถานะ 'shipping')
@app.route('/api/orders/<int:order_id>/cancel-request', methods=['POST'])
def request_order_cancel_and_refund(order_id):
    req = request.json or {}
    reason = (req.get('reason') or '').strip()
    bank_info = (req.get('bankInfo') or '').strip()

    conn = get_db_connection()
    cur = conn.cursor()
    order_row = cur.execute('SELECT * FROM orders WHERE order_id = ?', (order_id,)).fetchone()
    if not order_row:
        conn.close()
        return jsonify({"ok": False, "message": "ไม่พบคำสั่งซื้อนี้ในระบบ"}), 404

    current_status = order_row['order_status']
    if current_status in ('shipping', 'delivered', 'cancelled_refunded', 'rejected'):
        conn.close()
        return jsonify({"ok": False, "message": "ไม่สามารถยกเลิกได้เนื่องจากสินค้าอยู่ระหว่างการขนส่งหรือดำเนินการเสร็จสิ้นแล้ว"}), 400

    cur.execute('''
        UPDATE orders
        SET previous_status = ?, order_status = 'cancel_requested', cancel_reason = ?, refund_bank_info = ?
        WHERE order_id = ?
    ''', (current_status, reason, bank_info, order_id))

    cur.execute('''
        INSERT INTO notifications (user_id, order_number, title, message, is_read)
        VALUES (?, ?, ?, ?, 0)
    ''', (
        order_row['user_id'],
        order_row['order_number'],
        f"[{order_row['order_number']}] ส่งคำขอยกเลิกและขอคืนเงินแล้ว",
        f"ระบบได้รับคำขอยกเลิกคำสั่งซื้อของคุณแล้ว (เหตุผล: {reason}) ขณะนี้รอแอดมินตรวจสอบและดำเนินการโอนเงินคืน"
    ))

    cur.execute('''
        INSERT INTO admin_notifications (notif_type, title, message, ref_id)
        VALUES ('order', ?, ?, ?)
    ''', (
        f"⚠️ ขอยกเลิก/คืนเงิน {order_row['order_number']}",
        f"สาเหตุ: {reason} | บัญชีรับเงินคืน: {bank_info}",
        order_row['order_number']
    ))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route('/api/notifications', methods=['GET'])
def get_user_notifications():
    email = request.args.get('email', '').strip().lower()
    conn = get_db_connection()
    user = conn.execute('SELECT user_id FROM users WHERE LOWER(email) = ?', (email,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"notifications": [], "unreadCount": 0})

    rows = conn.execute(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY notif_id DESC',
        (user['user_id'],)
    ).fetchall()
    unread = sum(1 for r in rows if r['is_read'] == 0)
    conn.close()
    return jsonify({
        "notifications": [dict(r) for r in rows],
        "unreadCount": unread
    })


@app.route('/api/notifications/read', methods=['PUT'])
def mark_notifications_read():
    req = request.json or {}
    email = req.get('email', '').strip().lower()
    conn = get_db_connection()
    user = conn.execute('SELECT user_id FROM users WHERE LOWER(email) = ?', (email,)).fetchone()
    if user:
        conn.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', (user['user_id'],))
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route('/api/notifications/<int:notif_id>', methods=['DELETE'])
def delete_user_notification(notif_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM notifications WHERE notif_id = ?', (notif_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route('/api/reviews', methods=['POST'])
def create_review():
    req = request.json or {}
    item_type = req.get('itemType', 'other')
    ref_id = req.get('refId', '')
    reviewer = req.get('reviewerName', 'ผู้ใช้งาน')
    stars = int(req.get('stars', 5))
    comment = req.get('comment', '').strip()
    date_str = req.get('date', '')
    order_item_id = req.get('orderItemId')

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO reviews (item_type, ref_id, reviewer_name, stars, comment, review_date, is_admin_seen, is_hidden)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    ''', (item_type, ref_id, reviewer, stars, comment, date_str))

    if order_item_id:
        cur.execute('UPDATE order_items SET is_reviewed = 1 WHERE item_id = ?', (order_item_id,))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ==============================================================================
# 🛡️ API ระบบแอดมิน (Login, OTP, กระดิ่งแจ้งเตือน, ยอดขาย, จัดการสินค้า)
# ==============================================================================
@app.route('/api/admin/login', methods=['POST'])
def api_admin_login():
    req = request.json or {}
    username = req.get('username', '').strip()
    password = req.get('password', '')

    conn = get_db_connection()
    conn.execute('''
        UPDATE admins SET password_hash = ?, display_name = ? WHERE username = ?
    ''', (MASTER_ADMIN_PASSWORD, MASTER_ADMIN_DISPLAY_NAME, MASTER_ADMIN_USERNAME))
    conn.commit()

    admin_row = conn.execute(
        'SELECT * FROM admins WHERE LOWER(username) = LOWER(?) AND password_hash = ?',
        (username, password)
    ).fetchone()
    conn.close()

    if not admin_row:
        return jsonify({"ok": False, "message": "USERNAME หรือ PASSWORD ของแอดมินไม่ถูกต้อง"}), 401

    otp_code = str(random.randint(100000, 999999))
    temp_token = "ADM-" + str(random.randint(1000000, 9999999))
    ADMIN_OTP_SESSIONS[temp_token] = {
        "otp": otp_code,
        "admin": {
            "admin_id": admin_row['admin_id'],
            "username": admin_row['username'],
            "display_name": admin_row['display_name'],
            "email": admin_row['email'],
            "avatar_url": admin_row['avatar_url'],
            "permissions": admin_row['permissions']
        }
    }

    email_notice = "กรุณายืนยันรหัส OTP 6 หลักเพื่อเข้าสู่ระบบแอดมิน"
    target_email = ADMIN_OTP_RECEIVER_EMAIL or admin_row['email']

    if SMTP_SENDER_GMAIL and SMTP_GMAIL_APP_PASSWORD and target_email:
        try:
            msg = MIMEText(f"รหัส OTP สำหรับเข้าสู่ระบบแอดมิน HORSE BUDDY ของคุณคือ: {otp_code}")
            msg['Subject'] = "HORSE BUDDY - รหัส OTP เข้าสู่ระบบแอดมิน"
            msg['From'] = SMTP_SENDER_GMAIL
            msg['To'] = target_email
            with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                server.login(SMTP_SENDER_GMAIL, SMTP_GMAIL_APP_PASSWORD)
                server.sendmail(SMTP_SENDER_GMAIL, [target_email], msg.as_string())
            email_notice = f"ส่งรหัส OTP 6 หลักไปยังอีเมล {target_email} เรียบร้อยแล้ว"
        except Exception:
            email_notice = "โหมดทดสอบ OTP"

    return jsonify({
        "ok": True,
        "tempToken": temp_token,
        "demoOtp": otp_code,
        "emailNotice": email_notice
    })


@app.route('/api/admin/verify-otp', methods=['POST'])
def api_admin_verify_otp():
    req = request.json or {}
    temp_token = req.get('tempToken', '')
    otp = req.get('otp', '').strip()

    session_data = ADMIN_OTP_SESSIONS.get(temp_token)
    if not session_data or session_data['otp'] != otp:
        return jsonify({"ok": False, "message": "รหัส OTP 6 หลักไม่ถูกต้อง"}), 400

    admin_info = session_data['admin']
    del ADMIN_OTP_SESSIONS[temp_token]
    return jsonify({"ok": True, "admin": admin_info})


@app.route('/api/admin/avatar', methods=['PUT'])
def api_update_admin_avatar():
    req = request.json or {}
    username = req.get('username', MASTER_ADMIN_USERNAME).strip()
    avatar = req.get('avatar', '')

    conn = get_db_connection()
    conn.execute('UPDATE admins SET avatar_url = ? WHERE LOWER(username) = LOWER(?)', (avatar, username))
    conn.commit()
    admin_row = conn.execute('SELECT * FROM admins WHERE LOWER(username) = LOWER(?)', (username,)).fetchone()
    conn.close()

    if not admin_row:
        return jsonify({"ok": False}), 404

    return jsonify({
        "ok": True,
        "admin": {
            "admin_id": admin_row['admin_id'],
            "username": admin_row['username'],
            "display_name": admin_row['display_name'],
            "email": admin_row['email'],
            "avatar_url": admin_row['avatar_url'],
            "permissions": admin_row['permissions']
        }
    })


@app.route('/api/admin/notifications', methods=['GET'])
def api_get_admin_notifications():
    conn = get_db_connection()

    notifs = conn.execute('SELECT * FROM admin_notifications ORDER BY admin_notif_id DESC').fetchall()
    notif_list = [{
        "id": n['admin_notif_id'],
        "type": n['notif_type'],
        "title": n['title'],
        "message": n['message'],
        "ref_id": n['ref_id'],
        "created_at": n['created_at']
    } for n in notifs]

    pending_orders_count = conn.execute("SELECT COUNT(*) FROM orders WHERE order_status = 'pending_approval'").fetchone()[0]
    pending_support_count = conn.execute("SELECT COUNT(*) FROM support_requests WHERE status = 'pending'").fetchone()[0]
    new_reviews_count = conn.execute("SELECT COUNT(*) FROM reviews WHERE is_admin_seen = 0").fetchone()[0]

    prod_units_rows = conn.execute("SELECT product_id, unit_name FROM products").fetchall()
    product_units = {r['product_id']: (r['unit_name'] if r['unit_name'] else 'ชิ้น') for r in prod_units_rows}

    conn.close()
    resp = jsonify({
        "ok": True,
        "notifications": notif_list,
        "productUnits": product_units,
        "badges": {
            "bellTotal": len(notif_list),
            "approveOrders": pending_orders_count,
            "supportRequests": pending_support_count,
            "reviewsCount": new_reviews_count
        }
    })
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


@app.route('/api/admin/notifications/<int:notif_id>', methods=['DELETE'])
def api_delete_admin_notification(notif_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM admin_notifications WHERE admin_notif_id = ?', (notif_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route('/api/admin/sales-report', methods=['GET'])
def api_admin_sales_report():
    item_filter = request.args.get('filter', 'all')
    period = request.args.get('period', 'daily')

    conn = get_db_connection()
    orders = conn.execute('''
        SELECT o.*, u.username
        FROM orders o LEFT JOIN users u ON o.user_id = u.user_id
        WHERE o.order_status != 'rejected'
        ORDER BY o.order_id DESC
    ''').fetchall()

    total_revenue = 0.0
    total_qty = 0
    total_insurance = 0.0
    product_breakdown = {}
    table_rows = []

    for o in orders:
        items = conn.execute('SELECT * FROM order_items WHERE order_id = ?', (o['order_id'],)).fetchall()
        if item_filter == 'horse':
            filtered_items = [i for i in items if i['item_type'] == 'horse']
        elif item_filter == 'other':
            filtered_items = [i for i in items if i['item_type'] != 'horse']
        else:
            filtered_items = list(items)

        if not filtered_items:
            continue

        items_sum = sum(i['unit_price'] * i['quantity'] for i in filtered_items)
        items_qty = sum(i['quantity'] for i in filtered_items)

        order_net = o['grand_total'] if item_filter == 'all' else items_sum
        ins_fee = o['insurance_fee'] if ('insurance_fee' in o.keys() and o['insurance_fee']) else 0.0

        total_revenue += order_net
        total_qty += items_qty
        if item_filter in ('all', 'horse'):
            total_insurance += ins_fee

        for i in filtered_items:
            name = i['item_title']
            product_breakdown[name] = product_breakdown.get(name, 0.0) + (i['unit_price'] * i['quantity'])

        items_str = ", ".join([f"{i['item_title']} (x{i['quantity']})" for i in filtered_items])
        table_rows.append({
            "order_number": o['order_number'],
            "created_at": o['created_at'],
            "customer_name": o['username'] or "ลูกค้าทั่วไป",
            "address": o['shipping_address'],
            "items_text": items_str,
            "net_total": order_net
        })

    conn.close()

    if not product_breakdown:
        product_breakdown = {
            "อานม้า": 55,
            "เกือกม้า": 25,
            "เกลือชมพู": 15,
            "กล่องอุปกรณ์": 5
        }

    if period == 'daily':
        trend_labels = ["06.00", "08.00", "10.00", "12.00", "14.00"]
        trend_values = [1000, 13500, 28000, 2200, 20000]
    elif period == 'monthly':
        trend_labels = ["สัปดาห์ 1", "สัปดาห์ 2", "สัปดาห์ 3", "สัปดาห์ 4"]
        trend_values = [85000, 142000, 98000, 195000]
    else:
        trend_labels = ["ม.ค.", "มี.ค.", "พ.ค.", "ก.ค.", "ก.ย.", "พ.ย."]
        trend_values = [320000, 480000, 410000, 690000, 530000, 890000]

    return jsonify({
        "ok": True,
        "summary": {
            "totalRevenue": total_revenue,
            "totalQty": total_qty,
            "totalInsurance": total_insurance,
            "growthPercent": "+8.6%"
        },
        "pieChart": {
            "labels": list(product_breakdown.keys())[:6],
            "values": list(product_breakdown.values())[:6]
        },
        "lineChart": {
            "labels": trend_labels,
            "values": trend_values
        },
        "tableRows": table_rows
    })


@app.route('/api/admin/save-horse', methods=['POST'])
def api_admin_save_horse():
    req = request.json or {}
    horse_id = req.get('id', '').strip()
    is_new = False
    if not horse_id:
        horse_id = "h-" + req.get('category', 'racing') + "-" + str(random.randint(1000, 9999))
        is_new = True

    category = req.get('category', 'racing')
    breed = req.get('breed', '').strip()
    price_range = req.get('priceRange', '').strip()
    description = req.get('description', '').strip()
    vaccine_info = req.get('vaccineInfo', '').strip()
    images = req.get('images', [])
    variants = req.get('variants', {})

    conn = get_db_connection()
    cur = conn.cursor()

    if is_new:
        cur.execute('''
            INSERT INTO horses (horse_id, category, breed, price_range_text, description, vaccine_info, rating, review_count)
            VALUES (?, ?, ?, ?, ?, ?, 5.0, 2)
        ''', (horse_id, category, breed, price_range, description, vaccine_info))
    else:
        cur.execute('''
            UPDATE horses
            SET category = ?, breed = ?, price_range_text = ?, description = ?, vaccine_info = ?
            WHERE horse_id = ?
        ''', (category, breed, price_range, description, vaccine_info, horse_id))

    if images:
        cur.execute('DELETE FROM horse_images WHERE horse_id = ?', (horse_id,))
        for idx, img_url in enumerate(images):
            if img_url:
                cur.execute('''
                    INSERT INTO horse_images (horse_id, image_url, sort_order)
                    VALUES (?, ?, ?)
                ''', (horse_id, img_url, idx + 1))

    cur.execute('DELETE FROM horse_variants WHERE horse_id = ?', (horse_id,))
    for v_key in ('sire', 'dam'):
        v_data = variants.get(v_key, {})
        label = "พ่อพันธุ์" if v_key == "sire" else "แม่พันธุ์"
        cur.execute('''
            INSERT INTO horse_variants (horse_id, variant_type, variant_label, horse_name, age_text, health_status, market_price, stock)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            horse_id,
            v_key,
            label,
            v_data.get('horseName', breed),
            v_data.get('age', '4 ปี'),
            v_data.get('health', 'แข็งแรงสมบูรณ์'),
            float(v_data.get('price', 150000)),
            int(v_data.get('stock', 1))
        ))

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "horseId": horse_id})


@app.route('/api/admin/delete-horse/<horse_id>', methods=['DELETE'])
def api_admin_delete_horse(horse_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM horse_images WHERE horse_id = ?', (horse_id,))
    conn.execute('DELETE FROM horse_variants WHERE horse_id = ?', (horse_id,))
    conn.execute('DELETE FROM horses WHERE horse_id = ?', (horse_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route('/api/admin/save-product', methods=['POST'])
def api_admin_save_product():
    req = request.json or {}
    prod_id = req.get('id', '').strip()
    is_new = False
    if not prod_id:
        prod_id = "p-" + req.get('category', 'feed') + "-" + str(random.randint(1000, 9999))
        is_new = True

    category = req.get('category', 'feed')
    name = req.get('name', '').strip()
    price = float(req.get('price', 0))
    stock = int(req.get('stock', 1))
    unit_name = req.get('unit', 'ชิ้น').strip() or 'ชิ้น'
    image = req.get('image', '')
    description = req.get('description', '').strip()

    conn = get_db_connection()
    cur = conn.cursor()
    if is_new:
        cur.execute('''
            INSERT INTO products (product_id, category, product_name, price, stock, unit_name, image_url, description, rating, review_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5.0, 2)
        ''', (prod_id, category, name, price, stock, unit_name, image, description))
    else:
        cur.execute('''
            UPDATE products
            SET category = ?, product_name = ?, price = ?, stock = ?, unit_name = ?, image_url = ?, description = ?
            WHERE product_id = ?
        ''', (category, name, price, stock, unit_name, image, description, prod_id))

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "productId": prod_id})


@app.route('/api/admin/delete-product/<product_id>', methods=['DELETE'])
def api_admin_delete_product(product_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM products WHERE product_id = ?', (product_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})
# ==============================================================================
# 🚀 API เฟสแอดมิน ส่วนที่ 2 (อนุมัติ/ติดตามออเดอร์, คำร้อง/ผู้ใช้, ตั้งค่าฟาร์ม, แอดมิน, รีวิว)
# ==============================================================================
def ensure_phase2_settings_table():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS farm_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL
        )
    ''')
    default_settings = {
        "farm_name": "ขอนแก่น (สาขาหลัก)",
        "farm_lat": "16.4419",
        "farm_lng": "102.8360",
        "land_base": "3500",
        "land_per_km": "30",
        "land_stall_shared": "2500",
        "land_stall_single": "4500",
        "land_stall_vip": "16000",
        "air_base": "150000",
        "air_per_km": "50",
        "air_stall_shared": "100000",
        "air_stall_single": "350000",
        "air_stall_vip": "777000",
        "parcel_fee": "50"
    }
    for k, v in default_settings.items():
        cur.execute('INSERT OR IGNORE INTO farm_settings (setting_key, setting_value) VALUES (?, ?)', (k, str(v)))
    conn.commit()
    conn.close()


ensure_phase2_settings_table()


# ---------- 1. อนุมัติสินค้าและติดตามสินค้า ----------
@app.route('/api/admin/orders', methods=['GET'])
def api_admin_get_orders():
    conn = get_db_connection()
    orders_rows = conn.execute('''
        SELECT o.*, u.username, u.email, u.phone
        FROM orders o LEFT JOIN users u ON o.user_id = u.user_id
        ORDER BY o.order_id DESC
    ''').fetchall()

    result = []
    for o in orders_rows:
        o_keys = o.keys()
        items = conn.execute('SELECT * FROM order_items WHERE order_id = ?', (o['order_id'],)).fetchall()
        c_name = o['username'] or (o['customer_username'] if 'customer_username' in o_keys else '') or "ลูกค้าทั่วไป"
        c_phone = o['phone'] or (o['customer_phone'] if 'customer_phone' in o_keys else '') or "-"
        result.append({
            "orderId": o['order_id'],
            "orderNumber": o['order_number'],
            "userId": o['user_id'],
            "customerName": c_name,
            "customerEmail": o['email'] or (o['customer_email'] if 'customer_email' in o_keys else ''),
            "customerPhone": c_phone,
            "paymentMethod": o['payment_method'],
            "subtotal": o['subtotal'],
            "vat": o['vat_amount'],
            "grandTotal": o['grand_total'],
            "slipImage": o['slip_image_url'] or "",
            "shippingAddress": o['shipping_address'],
            "status": o['order_status'],
            "cancelReason": o['cancel_reason'] if 'cancel_reason' in o_keys else '',
            "refundBankInfo": o['refund_bank_info'] if 'refund_bank_info' in o_keys else '',
            "previousStatus": o['previous_status'] if 'previous_status' in o_keys else 'preparing',
            "shippingScope": o['shipping_scope'] if 'shipping_scope' in o_keys else 'ในประเทศ',
            "transportMode": o['transport_mode'] if 'transport_mode' in o_keys else 'land',
            "stallType": o['stall_type'] if 'stall_type' in o_keys else 'shared',
            "distanceKm": o['distance_km'] if 'distance_km' in o_keys else 0.0,
            "shippingCost": o['shipping_cost'] if 'shipping_cost' in o_keys else 0.0,
            "travelExpense": o['travel_expense'] if 'travel_expense' in o_keys else 0.0,
            "docFee": o['doc_fee'] if 'doc_fee' in o_keys else 0.0,
            "insuranceFee": o['insurance_fee'] if 'insurance_fee' in o_keys else 0.0,
            "createdAt": o['created_at'],
            "items": [{
                "title": i['item_title'],
                "price": i['unit_price'],
                "qty": i['quantity'],
                "type": i['item_type']
            } for i in items]
        })
    conn.close()
    return jsonify({"ok": True, "orders": result})


@app.route('/api/admin/orders/<int:order_id>/status', methods=['PUT'])
def api_admin_update_order_status(order_id):
    req = request.json or {}
    new_status = req.get('status', 'preparing')
    custom_note = req.get('note', '').strip()

    status_titles = {
        "preparing": "คำสั่งซื้อได้รับการอนุมัติแล้ว (กำลังเตรียมการจัดส่ง)",
        "shipping": "สินค้า/ม้าของคุณอยู่ระหว่างการขนส่ง",
        "delivered": "จัดส่งสินค้า/ม้าถึงปลายทางสำเร็จเรียบร้อย!",
        "cancelled_refunded": "อนุมัติการยกเลิกคำสั่งซื้อและโอนเงินคืนเรียบร้อยแล้ว",
        "rejected": "คำสั่งซื้อของคุณถูกยกเลิก/ไม่ผ่านการอนุมัติ"
    }
    status_messages = {
        "preparing": "แอดมินตรวจสอบสลิปและอนุมัติคำสั่งซื้อเรียบร้อยแล้ว ขณะนี้ทีมงานและสัตวแพทย์กำลังเตรียมความพร้อมก่อนออกเดินทาง",
        "shipping": "ขบวนขนส่งออกเดินทางจากฟาร์มแล้ว คุณสามารถเตรียมรับสินค้าตามที่อยู่ที่ระบุไว้ได้เลยครับ",
        "delivered": "การจัดส่งเสร็จสมบูรณ์ ขอบคุณที่ไว้วางใจ HORSE BUDDY คุณสามารถเข้าไปกดให้คะแนนรีวิวสินค้าได้ในหน้าประวัติคำสั่งซื้อครับ",
        "cancelled_refunded": "แอดมินได้อนุมัติคำขอยกเลิกคำสั่งซื้อและดำเนินการโอนเงินคืนเข้าบัญชีที่คุณระบุเรียบร้อยแล้วครับ",
        "rejected": "หลักฐานการชำระเงินไม่ถูกต้องหรือไม่ผ่านการอนุมัติ กรุณาติดต่อแอดมินหากต้องการข้อมูลเพิ่มเติม"
    }

    conn = get_db_connection()
    cur = conn.cursor()
    order_row = cur.execute('SELECT * FROM orders WHERE order_id = ?', (order_id,)).fetchone()
    if not order_row:
        conn.close()
        return jsonify({"ok": False, "message": "ไม่พบคำสั่งซื้อ"}), 404

    old_status = order_row['order_status']

    # หากแอดมินอนุมัติการยกเลิกและคืนเงิน หรือปฏิเสธออเดอร์ ให้คืนจำนวนสต็อกม้า/สินค้ากลับเข้าระบบอัตโนมัติ
    if new_status in ('cancelled_refunded', 'rejected') and old_status not in ('cancelled_refunded', 'rejected'):
        items_rows = cur.execute('SELECT * FROM order_items WHERE order_id = ?', (order_id,)).fetchall()
        for item in items_rows:
            if item['item_type'] == 'horse':
                cur.execute('''
                    UPDATE horse_variants SET stock = stock + ? WHERE horse_id = ? AND variant_type = ?
                ''', (int(item['quantity']), item['ref_id'], item['variant_type']))
            else:
                cur.execute('''
                    UPDATE products SET stock = stock + ? WHERE product_id = ?
                ''', (int(item['quantity']), item['ref_id']))

    cur.execute('UPDATE orders SET order_status = ? WHERE order_id = ?', (new_status, order_id))

    title = f"[{order_row['order_number']}] " + status_titles.get(new_status, "อัปเดตสถานะคำสั่งซื้อ")
    msg = custom_note if custom_note else status_messages.get(new_status, "สถานะคำสั่งซื้อของคุณได้รับการอัปเดตแล้ว")
    cur.execute('''
        INSERT INTO notifications (user_id, order_number, title, message, is_read)
        VALUES (?, ?, ?, ?, 0)
    ''', (order_row['user_id'], order_row['order_number'], title, msg))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------- 2. คำร้องและบัญชีผู้ใช้งาน ----------
@app.route('/api/admin/support-and-users', methods=['GET'])
def api_admin_get_support_and_users():
    conn = get_db_connection()
    reqs = conn.execute('SELECT * FROM support_requests ORDER BY request_id DESC').fetchall()
    users = conn.execute('SELECT * FROM users ORDER BY user_id DESC').fetchall()
    conn.close()

    return jsonify({
        "ok": True,
        "supportRequests": [dict(r) for r in reqs],
        "users": [build_user_dict(u) for u in users]
    })


@app.route('/api/admin/support-requests/<int:req_id>', methods=['PUT', 'DELETE'])
def api_admin_manage_support_request(req_id):
    conn = get_db_connection()
    if request.method == 'DELETE':
        conn.execute('DELETE FROM support_requests WHERE request_id = ?', (req_id,))
    else:
        status = (request.json or {}).get('status', 'resolved')
        conn.execute('UPDATE support_requests SET status = ? WHERE request_id = ?', (status, req_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
def api_admin_update_user(user_id):
    req = request.json or {}
    username = (req.get('username') or '').strip()
    email = (req.get('email') or '').strip().lower()
    phone = (req.get('phone') or '').strip()
    address = (req.get('address') or '').strip()

    conn = get_db_connection()
    if conn.execute('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND user_id != ?', (username, user_id)).fetchone():
        conn.close()
        return jsonify({"ok": False, "message": "Username นี้ซ้ำกับผู้ใช้อื่นในระบบ"}), 400
    if conn.execute('SELECT 1 FROM users WHERE LOWER(email) = ? AND user_id != ?', (email, user_id)).fetchone():
        conn.close()
        return jsonify({"ok": False, "message": "Gmail นี้ซ้ำกับผู้ใช้อื่นในระบบ"}), 400
    if conn.execute('SELECT 1 FROM users WHERE phone = ? AND user_id != ?', (phone, user_id)).fetchone():
        conn.close()
        return jsonify({"ok": False, "message": "เบอร์โทรศัพท์นี้ซ้ำกับผู้ใช้อื่นในระบบ"}), 400

    # อัปเดตเฉพาะข้อมูลทั่วไป โดยไม่แตะต้อง password_hash ของลูกค้าเพื่อความเป็นส่วนตัว
    conn.execute('''
        UPDATE users SET username = ?, email = ?, phone = ?, address = ?
        WHERE user_id = ?
    ''', (username, email, phone, address, user_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------- 3. ตั้งค่าระบบฟาร์มและเรทค่าขนส่ง ----------
@app.route('/api/settings', methods=['GET'])
def api_get_farm_settings():
    conn = get_db_connection()
    rows = conn.execute('SELECT setting_key, setting_value FROM farm_settings').fetchall()
    conn.close()
    settings = {r['setting_key']: r['setting_value'] for r in rows}
    return jsonify({"ok": True, "settings": settings})


@app.route('/api/admin/settings', methods=['PUT'])
def api_admin_save_farm_settings():
    req = request.json or {}
    conn = get_db_connection()
    cur = conn.cursor()
    for k, v in req.items():
        cur.execute('''
            INSERT INTO farm_settings (setting_key, setting_value)
            VALUES (?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
        ''', (k, str(v)))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------- 4. เพิ่มแอดมินและกำหนดสิทธิ์ ----------
@app.route('/api/admin/admins', methods=['GET', 'POST'])
def api_admin_manage_admins():
    conn = get_db_connection()
    if request.method == 'GET':
        rows = conn.execute('SELECT * FROM admins ORDER BY admin_id ASC').fetchall()
        conn.close()
        return jsonify({
            "ok": True,
            "admins": [{
                "admin_id": r['admin_id'],
                "username": r['username'],
                "password": r['password_hash'],
                "display_name": r['display_name'],
                "email": r['email'],
                "avatar_url": r['avatar_url'],
                "permissions": r['permissions']
            } for r in rows]
        })

    req = request.json or {}
    username = req.get('username', '').strip()
    password = req.get('password', '').strip()
    display_name = req.get('display_name', '').strip() or username
    email = req.get('email', '').strip()
    permissions = req.get('permissions', 'all')

    if not username or not password:
        conn.close()
        return jsonify({"ok": False, "message": "กรุณากรอก Username และ Password"}), 400

    try:
        conn.execute('''
            INSERT INTO admins (username, password_hash, display_name, email, avatar_url, permissions)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            username, password, display_name, email,
            f"https://api.dicebear.com/7.x/adventurer/svg?seed={username}",
            permissions
        ))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"ok": False, "message": "Username แอดมินนี้มีอยู่ในระบบแล้ว"}), 400

    conn.close()
    return jsonify({"ok": True})


@app.route('/api/admin/admins/<int:admin_id>', methods=['PUT', 'DELETE'])
def api_admin_update_or_delete_admin(admin_id):
    conn = get_db_connection()
    target = conn.execute('SELECT * FROM admins WHERE admin_id = ?', (admin_id,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"ok": False, "message": "ไม่พบแอดมิน"}), 404

    if request.method == 'DELETE':
        if target['username'].lower() == MASTER_ADMIN_USERNAME.lower():
            conn.close()
            return jsonify({"ok": False, "message": "ไม่สามารถลบบัญชีหัวหน้าแอดมินหลักได้"}), 400
        conn.execute('DELETE FROM admins WHERE admin_id = ?', (admin_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})

    req = request.json or {}
    display_name = req.get('display_name', target['display_name']).strip()
    password = req.get('password', target['password_hash']).strip()
    email = req.get('email', target['email']).strip()
    permissions = req.get('permissions', target['permissions'])

    conn.execute('''
        UPDATE admins
        SET display_name = ?, password_hash = ?, email = ?, permissions = ?
        WHERE admin_id = ?
    ''', (display_name, password, email, permissions, admin_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------- 5. คำสั่งซื้อและรีวิว (ตรวจสอบ/ซ่อน/ลบรีวิว) ----------
@app.route('/api/admin/reviews', methods=['GET'])
def api_admin_get_reviews():
    conn = get_db_connection()
    # เมื่อแอดมินเปิดดูหน้ารีวิว ให้ล้างสถานะจุดแดงของรีวิวใหม่ทันที
    conn.execute('UPDATE reviews SET is_admin_seen = 1')
    conn.commit()

    rows = conn.execute('SELECT * FROM reviews ORDER BY review_id DESC').fetchall()
    horses_map = {r['horse_id']: r['breed'] for r in conn.execute('SELECT horse_id, breed FROM horses').fetchall()}
    prods_map = {r['product_id']: r['product_name'] for r in conn.execute('SELECT product_id, product_name FROM products').fetchall()}
    conn.close()

    reviews_list = []
    for r in rows:
        r_keys = r.keys()
        item_name = horses_map.get(r['ref_id']) if r['item_type'] == 'horse' else prods_map.get(r['ref_id'])
        reviews_list.append({
            "reviewId": r['review_id'],
            "itemType": r['item_type'],
            "refId": r['ref_id'],
            "itemName": item_name or r['ref_id'],
            "reviewerName": r['reviewer_name'],
            "stars": r['stars'],
            "comment": r['comment'],
            "date": r['review_date'],
            "isHidden": bool(r['is_hidden']) if 'is_hidden' in r_keys else False
        })
    return jsonify({"ok": True, "reviews": reviews_list})


@app.route('/api/admin/reviews/<int:review_id>/toggle', methods=['PUT'])
def api_admin_toggle_review_visibility(review_id):
    conn = get_db_connection()
    row = conn.execute('SELECT is_hidden FROM reviews WHERE review_id = ?', (review_id,)).fetchone()
    if row:
        next_val = 0 if row['is_hidden'] else 1
        conn.execute('UPDATE reviews SET is_hidden = ? WHERE review_id = ?', (next_val, review_id))
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route('/api/admin/reviews/<int:review_id>', methods=['DELETE'])
def api_admin_delete_review(review_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM reviews WHERE review_id = ?', (review_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

import smtplib
import time
import json
import urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ==============================================================================
# 🔑 ตั้งค่าระบบส่ง OTP เข้า Gmail จริง และ Google OAuth 2.0 (ใส่ค่าที่คุณเตรียมไว้ตรงนี้)
# ==============================================================================
SMTP_SENDER_EMAIL = "kokdnuzoo@gmail.com"          # 1. ใส่ Gmail ของคุณที่ใช้ส่ง OTP
SMTP_APP_PASSWORD = "pibo vshy nfsq dnig"           # 2. ใส่รหัส App Password 16 หลักจาก Google
GOOGLE_CLIENT_ID = "14364493767-3p7u2laov5b15npcg5ogehrmlgqll48g.apps.googleusercontent.com"  # 3. ใส่ Google Client ID

# เก็บรหัส OTP 6 หลักไว้ฝั่งเซิร์ฟเวอร์ (มีอายุ 5 นาที)
PENDING_OTP_STORE = {}


def send_real_email_otp(target_email, otp_code, purpose_text="ยืนยันตัวตน"):
    sender = SMTP_SENDER_EMAIL.strip()
    app_pass = SMTP_APP_PASSWORD.replace(" ", "").strip()

    if not sender or "your_email" in sender or not app_pass or "xxxx" in app_pass:
        return False, "ยังไม่ได้ตั้งค่า SMTP_SENDER_EMAIL หรือ SMTP_APP_PASSWORD ในไฟล์ app.py"

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[HORSE BUDDY] รหัส OTP ยืนยันตัวตนของคุณคือ {otp_code}"
        msg["From"] = f"HORSE BUDDY FARM <{sender}>"
        msg["To"] = target_email

        html_body = f"""
        <div style="font-family: 'Prompt', sans-serif; max-width: 480px; margin: 0 auto; background: #111113; color: #ffffff; padding: 28px; border-radius: 24px; border: 1px solid #333;">
            <h2 style="color: #FACC15; margin-top: 0; text-align: center; letter-spacing: 2px;">HORSE BUDDY</h2>
            <p style="color: #e5e7eb; font-size: 14px; text-align: center;">รหัส OTP 6 หลักสำหรับ <strong>{purpose_text}</strong> ของคุณคือ:</p>
            <div style="background: #1f1f23; border: 2px solid #ea580c; border-radius: 16px; padding: 16px; text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #ffffff;">{otp_code}</span>
            </div>
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">*รหัสนี้มีอายุการใช้งาน 5 นาที กรุณาอย่าเปิดเผยรหัสนี้แก่ผู้อื่น</p>
        </div>
        """
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=12) as server:
            server.login(sender, app_pass)
            server.sendmail(sender, [target_email], msg.as_string())

        return True, "ส่งรหัส OTP ไปยัง Gmail เรียบร้อยแล้ว"
    except Exception as e:
        return False, f"ส่งอีเมลไม่สำเร็จ: {str(e)}"


@app.route('/api/auth/config', methods=['GET'])
def api_get_auth_config():
    return jsonify({
        "ok": True,
        "googleClientId": GOOGLE_CLIENT_ID.strip()
    })


@app.route('/api/auth/precheck', methods=['POST'])
def api_auth_precheck():
    req = request.json or {}
    mode = req.get('mode', 'register')
    user_id = req.get('userId')
    old_email = (req.get('oldEmail') or '').strip().lower()
    old_username = (req.get('oldUsername') or '').strip()
    username = (req.get('username') or '').strip()
    email = (req.get('email') or '').strip().lower()
    phone = (req.get('phone') or '').strip()
    password = req.get('password', '')

    # ตรวจสอบความยาวรหัสผ่านต้อง 8 ตัวอักษรขึ้นไป
    if mode in ('register', 'security') and len(password) < 8:
        return jsonify({"ok": False, "message": "รหัสผ่าน (PASSWORD) ต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป"}), 400

    conn = get_db_connection()
    exclude_id = -1
    if mode == 'security':
        user = find_or_restore_user_row(
            conn,
            user_id=user_id,
            email=old_email or email,
            username=old_username or username,
            phone=phone,
            password=password
        )
        if user:
            exclude_id = user['user_id']

    if mode in ('register', 'security'):
        if conn.execute('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND user_id != ?', (username, exclude_id)).fetchone():
            conn.close()
            return jsonify({"ok": False, "message": "ชื่อผู้ใช้งาน (USERNAME) นี้ถูกใช้งานแล้ว"}), 400
        if conn.execute('SELECT 1 FROM users WHERE LOWER(email) = ? AND user_id != ?', (email, exclude_id)).fetchone():
            conn.close()
            return jsonify({"ok": False, "message": "GMAIL นี้ถูกใช้งานแล้ว (1 Gmail = 1 บัญชี)"}), 400
        if conn.execute('SELECT 1 FROM users WHERE phone = ? AND user_id != ?', (phone, exclude_id)).fetchone():
            conn.close()
            return jsonify({"ok": False, "message": "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว (1 เบอร์ = 1 บัญชี)"}), 400

    conn.close()

    # สร้างรหัส OTP 6 หลักและส่งเข้า Gmail จริงของลูกค้า
    otp_code = str(random.randint(100000, 999999))
    PENDING_OTP_STORE[email] = {
        "code": otp_code,
        "expires_at": time.time() + 300
    }

    purpose_map = {
        "register": "สมัครสมาชิกใหม่ (SIGN UP)",
        "security": "แก้ไขข้อมูลบัญชีและความปลอดภัย",
        "google": "เข้าสู่ระบบด้วยบัญชี Google"
    }
    sent_ok, msg = send_real_email_otp(email, otp_code, purpose_map.get(mode, "ยืนยันตัวตน"))
    if not sent_ok:
        return jsonify({"ok": False, "message": msg}), 500

    return jsonify({"ok": True, "message": "ส่งรหัส OTP 6 หลักไปยังอีเมลของคุณแล้ว"})


@app.route('/api/auth/verify-otp', methods=['POST'])
def api_auth_verify_otp():
    req = request.json or {}
    email = (req.get('email') or '').strip().lower()
    entered_code = (req.get('otp') or '').strip()

    record = PENDING_OTP_STORE.get(email)
    if not record:
        return jsonify({"ok": False, "message": "ไม่พบรหัส OTP หรือรหัสหมดอายุแล้ว กรุณากดขอรหัสใหม่"}), 400

    if time.time() > record['expires_at']:
        PENDING_OTP_STORE.pop(email, None)
        return jsonify({"ok": False, "message": "รหัส OTP หมดอายุแล้ว (เกิน 5 นาที) กรุณากดส่งรหัสอีกครั้ง"}), 400

    if entered_code != record['code']:
        return jsonify({"ok": False, "message": "รหัส OTP 6 หลักไม่ถูกต้อง กรุณาตรวจสอบใน Gmail ของคุณอีกครั้ง"}), 400

    # เมื่อยืนยันผ่านแล้วให้ลบรหัสที่ใช้แล้วออกทันที
    PENDING_OTP_STORE.pop(email, None)
    return jsonify({"ok": True})


@app.route('/api/auth/google-profile', methods=['POST'])
def api_auth_google_profile():
    req = request.json or {}
    access_token = (req.get('accessToken') or '').strip()
    if not access_token:
        return jsonify({"ok": False, "message": "ไม่พบ Access Token จาก Google"}), 400

    try:
        google_req = urllib.request.Request(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        with urllib.request.urlopen(google_req, timeout=10) as resp:
            info = json.loads(resp.read().decode("utf-8"))

        email = (info.get("email") or "").strip().lower()
        name = (info.get("name") or email.split("@")[0]).strip()
        picture = info.get("picture") or f"https://api.dicebear.com/7.x/bottts/svg?seed={name}"

        if not email:
            return jsonify({"ok": False, "message": "ไม่สามารถดึงอีเมลจากบัญชี Google ได้"}), 400

        # ส่งรหัส OTP 6 หลักไปยัง Gmail ที่ผู้ใช้เลือกจาก Google OAuth
        otp_code = str(random.randint(100000, 999999))
        PENDING_OTP_STORE[email] = {
            "code": otp_code,
            "expires_at": time.time() + 300
        }
        sent_ok, msg = send_real_email_otp(email, otp_code, "เข้าสู่ระบบด้วยบัญชี Google")
        if not sent_ok:
            return jsonify({"ok": False, "message": msg}), 500

        return jsonify({
            "ok": True,
            "googleUser": {
                "email": email,
                "username": name,
                "avatar": picture
            }
        })
    except Exception as e:
        return jsonify({"ok": False, "message": f"ตรวจสอบบัญชี Google ไม่สำเร็จ: {str(e)}"}), 400

# ==============================================================================
# สเตปที่ 3: ระบบลืมรหัสผ่าน (Forgot Password) ด้วย OTP ทาง Gmail + ปิดซ่อนรหัสผ่านลูกค้าจากแอดมิน
# ==============================================================================

# 1. API ขอรับรหัส OTP 6 หลักทาง Gmail สำหรับคนลืมรหัสผ่าน
@app.route('/api/auth/forgot-password/send-otp', methods=['POST'])
def api_forgot_password_send_otp():
    req = request.json or {}
    identifier = (req.get('identifier') or '').strip().lower()
    if not identifier:
        return jsonify({"ok": False, "message": "กรุณากรอก GMAIL หรือ ชื่อผู้ใช้งาน ของคุณ"}), 400

    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?',
        (identifier, identifier)
    ).fetchone()
    conn.close()

    if not user:
        return jsonify({"ok": False, "message": "ไม่พบบัญชีผู้ใช้งานนี้ในระบบ กรุณาตรวจสอบ Gmail หรือ Username อีกครั้ง"}), 404

    target_email = user['email'].strip().lower()
    otp_code = str(random.randint(100000, 999999))
    PENDING_OTP_STORE[f"reset_{target_email}"] = {
        "code": otp_code,
        "expires_at": time.time() + 300
    }

    sent_ok, msg = send_real_email_otp(target_email, otp_code, "ตั้งรหัสผ่านใหม่ (Reset Password)")
    if not sent_ok:
        return jsonify({"ok": False, "message": msg}), 500

    return jsonify({
        "ok": True,
        "email": target_email,
        "username": user['username'],
        "message": f"ส่งรหัส OTP 6 หลักไปยัง {target_email} เรียบร้อยแล้ว"
    })


# 2. API ยืนยันรหัส OTP 6 หลัก และตั้งรหัสผ่านใหม่ (ต้อง 8 ตัวอักษรขึ้นไป)
@app.route('/api/auth/forgot-password/reset', methods=['POST'])
def api_forgot_password_reset():
    req = request.json or {}
    email = (req.get('email') or '').strip().lower()
    otp_entered = (req.get('otp') or '').strip()
    new_password = req.get('newPassword') or ''

    if len(new_password) < 8:
        return jsonify({"ok": False, "message": "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป"}), 400

    record = PENDING_OTP_STORE.get(f"reset_{email}")
    if not record:
        return jsonify({"ok": False, "message": "ไม่พบรหัส OTP หรือรหัสหมดอายุแล้ว กรุณากดขอรหัส OTP ใหม่"}), 400

    if time.time() > record['expires_at']:
        PENDING_OTP_STORE.pop(f"reset_{email}", None)
        return jsonify({"ok": False, "message": "รหัส OTP หมดอายุแล้ว (เกิน 5 นาที) กรุณาขอรหัสใหม่"}), 400

    if otp_entered != record['code']:
        return jsonify({"ok": False, "message": "รหัส OTP 6 หลักไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง"}), 400

    conn = get_db_connection()
    user = conn.execute('SELECT user_id FROM users WHERE LOWER(email) = ?', (email,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"ok": False, "message": "ไม่พบบัญชีผู้ใช้งาน"}), 404

    conn.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', (new_password, user['user_id']))
    conn.commit()
    conn.close()

    PENDING_OTP_STORE.pop(f"reset_{email}", None)
    return jsonify({"ok": True, "message": "ตั้งรหัสผ่านใหม่สำเร็จ! คุณสามารถเข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ทันที"})

@app.route('/<path:path>')
def serve_static_files(path):
    return send_from_directory('.', path)


if __name__ == '__main__':
    app.run(debug=True, port=5000)