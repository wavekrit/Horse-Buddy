-- ============================================================================
-- HORSE BUDDY DATABASE SCHEMA (สำหรับ SQLite / datauma.db)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ลบตารางเดิมก่อน (เผื่อกรณีรันซ้ำ)
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS horse_variants;
DROP TABLE IF EXISTS horse_images;
DROP TABLE IF EXISTS horses;
DROP TABLE IF EXISTS users;

-- 1. ตารางผู้ใช้งานและแอดมิน (users)
CREATE TABLE users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  address TEXT NOT NULL,
  avatar_url TEXT DEFAULT 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
  role TEXT DEFAULT 'customer' CHECK(role IN ('customer', 'admin')),
  is_otp_verified INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. ตารางสายพันธุ์ม้าหลัก (horses)
CREATE TABLE horses (
  horse_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('racing', 'show')),
  breed TEXT NOT NULL,
  price_range_text TEXT NOT NULL,
  description TEXT NOT NULL,
  vaccine_info TEXT NOT NULL,
  rating REAL DEFAULT 5.0,
  review_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. ตารางรูปภาพประกอบของม้า (horse_images)
CREATE TABLE horse_images (
  image_id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 1,
  FOREIGN KEY (horse_id) REFERENCES horses(horse_id) ON DELETE CASCADE
);

-- 4. ตารางข้อมูลพ่อพันธุ์และแม่พันธุ์ (horse_variants)
CREATE TABLE horse_variants (
  variant_id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id TEXT NOT NULL,
  variant_type TEXT NOT NULL CHECK(variant_type IN ('stallion', 'mare')),
  variant_label TEXT NOT NULL,
  horse_name TEXT NOT NULL,
  age_text TEXT NOT NULL,
  health_status TEXT NOT NULL,
  market_price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (horse_id) REFERENCES horses(horse_id) ON DELETE CASCADE
);

-- 5. ตารางสินค้าอื่นๆ: อาหารสัตว์ และ อุปกรณ์เสริมสำหรับม้า (products)
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('feed', 'equipment')),
  product_name TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL,
  description TEXT NOT NULL,
  rating REAL DEFAULT 5.0,
  review_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. ตารางคำสั่งซื้อและการชำระเงิน (orders)
CREATE TABLE orders (
  order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('qr', 'bank', 'card')),
  installment_months INTEGER DEFAULT 0,
  subtotal REAL NOT NULL,
  vat_amount REAL NOT NULL,
  grand_total REAL NOT NULL,
  deposit_amount REAL NOT NULL,
  monthly_installment REAL DEFAULT 0.00,
  slip_image_url TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  order_status TEXT DEFAULT 'pending_approval' CHECK(order_status IN ('pending_approval', 'approved', 'shipped', 'completed', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- 7. ตารางรายการสินค้าในแต่ละคำสั่งซื้อ (order_items)
CREATE TABLE order_items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('horse', 'other')),
  ref_id TEXT NOT NULL,
  variant_type TEXT DEFAULT NULL,
  item_title TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

-- ==================== ข้อมูลเริ่มต้น (SEED DATA) ====================
INSERT INTO users (username, email, phone, password_hash, address, role, is_otp_verified)
VALUES
('admin_hb', 'admin@horsebuddy.com', '029998888', 'admin12345', 'สำนักงานใหญ่ Horse Buddy Thailand', 'admin', 1),
('cowboy_demo', 'demo@gmail.com', '0812345678', 'password123', '199 หมู่ 4 ฟาร์มตะวันทอง ต.ปากช่อง อ.ปากช่อง จ.นครราชสีมา 30130', 'customer', 1);

INSERT INTO horses (horse_id, category, breed, price_range_text, description, vaccine_info, rating, review_count)
VALUES
('h-racing-1', 'racing', 'AMERICAN QUARTER HORSE', '52,000 - 1,225,000 ฿', 'ม้าสายพันธุ์อเมริกันควอเตอร์ กล้ามเนื้อแน่นแข็งแรง ออกตัวเร็วที่สุดในระยะสั้น', 'ฉีดวัคซีนครบ 4 ชนิด (ไข้หวัดม้า, บาดทะยัก, JE, พิษสุนัขบ้า)', 5.0, 54),
('h-show-1', 'show', 'FRIESIAN', '175,000 - 3,500,000+ ฿', 'ม้าฟรีเชียนสีดำปลอดอันเลื่องชื่อ แผงคอและหางยาวเป็นลอนสวยงาม', 'ฉีดวัคซีนครบ 4 ชนิด (ไข้หวัดม้า, บาดทะยัก, JE, พิษสุนัขบ้า)', 5.0, 67);

INSERT INTO horse_variants (horse_id, variant_type, variant_label, horse_name, age_text, health_status, market_price, stock)
VALUES
('h-racing-1', 'stallion', 'พ่อพันธุ์', 'Blaze Dakota (เบลซ ดาโกต้า)', '5 ปี', 'สมบูรณ์แข็งแรง 100%', 890000, 2),
('h-racing-1', 'mare', 'แม่พันธุ์', 'Amber Wind (แอมเบอร์ วินด์)', '4 ปี', 'สมบูรณ์แข็งแรง 100%', 650000, 3),
('h-show-1', 'stallion', 'พ่อพันธุ์', 'Midnight Magnus (มิดไนท์ แมกนัส)', '5 ปี', 'สมบูรณ์แข็งแรง 100%', 3670000, 2),
('h-show-1', 'mare', 'แม่พันธุ์', 'Onyx Duchess (โอนิกซ์ ดัชเชส)', '4 ปี', 'สมบูรณ์แข็งแรง 100%', 2950000, 1);

INSERT INTO products (product_id, category, product_name, price, stock, image_url, description, rating, review_Count)
VALUES
('p-feed-1', 'feed', 'หญ้าอัลฟัลฟ่าอัดก้อนเกรดพรีเมียม (Alfalfa Hay 25 kg)', 1450, 25, 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=700&q=80', 'หญ้าอัลฟัลฟ่านำเข้า โปรตีนและแคลเซียมสูง', 4.9, 112),
('p-eq-1', 'equipment', 'อานม้าหนังแท้สไตล์คาวบอยตะวันตก (Western Leather Saddle)', 28500, 5, 'https://images.unsplash.com/photo-1534773728080-33d31da27ae5?auto=format&fit=crop&w=700&q=80', 'งานฝีมือหนังวัวแท้แกะสลักลวดลายคาวบอย', 5.0, 39);