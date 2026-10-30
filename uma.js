// ============================================================================
// HORSE BUDDY - CUSTOMER FRONTEND SCRIPT (uma.js ฉบับสมบูรณ์ เชื่อมต่อ datauma.db)
// ============================================================================

const FARM_ORIGIN_LAT = 16.4419; // พิกัดตั้งต้นฟาร์ม จ.ขอนแก่น
const FARM_ORIGIN_LNG = 102.8360;

let horsesData = [];
let otherProductsData = [];
let currentUser = null;
let cart = [];
let checkoutItems = [];

// สถานะของหน้าต่างดูรายละเอียดสินค้า
let currentDetailType = "horse"; // 'horse' หรือ 'other'
let currentDetailId = "";
let currentDetailVariant = "sire"; // 'sire' หรือ 'dam'
let currentDetailQty = 1;

// สถานะของหน้าต่างชำระเงิน 3 ขั้นตอน
let selectedPaymentMethod = "qr"; // 'qr' หรือ 'bank'
let chkSelectedTransportMode = "land";
let chkSelectedStallType = "shared";

// สถานะแผนที่ปักหมุดที่อยู่ของผู้ใช้
let leafletMap = null;
let leafletMarker = null;
let pinnedLat = FARM_ORIGIN_LAT;
let pinnedLng = FARM_ORIGIN_LNG;
let pinnedDistanceKm = 0;

// สถานะสำหรับเข้าสู่ระบบแอดมินผ่านโค้ดลับ
let pendingAdminToken = null;

// ============================================================================
// 1. เริ่มต้นระบบ โหลดข้อมูลจากฐานข้อมูล และซิงค์แบบเรียลไทม์
// ============================================================================
window.addEventListener("DOMContentLoaded", async () => {
  loadUserSession();
  setupSearchEnterListener();
  await loadInitialData();
  if (currentUser) {
    await refreshUnreadNotificationBadge();
  }
});

// ดักฟังสัญญาณเรียลไทม์เมื่อแอดมินแก้ไขสินค้าหรือลักษณะนามในหน้าหลังบ้าน
window.addEventListener("storage", e => {
  if (e.key === "hb_catalog_realtime_sync") {
    loadInitialData();
  }
});

window.addEventListener("pageshow", () => {
  loadInitialData();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadInitialData();
  }
});

async function loadInitialData() {
  try {
    const res = await fetch(`/api/data?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch /api/data");
    const data = await res.json();

    horsesData = Array.isArray(data.horsesData) ? data.horsesData : [];
    otherProductsData = Array.isArray(data.otherProductsData) ? data.otherProductsData : [];
    renderAllCatalogs();
  } catch (err) {
    console.error("Error loading catalog from server:", err);
  }
}

function formatTHB(num) {
  return `${Number(num || 0).toLocaleString("th-TH")} ฿`;
}

function showToast(message) {
  const toast = document.getElementById("toastNotification");
  const msgEl = document.getElementById("toastMessageText");
  if (!toast || !msgEl) return;
  msgEl.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove("hidden");
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add("hidden");
}

// ============================================================================
// 2. วาดการ์ดม้า (RACING / SHOW) และสินค้าทั่วไป (พร้อมลักษณะนามตามหลังบ้าน)
// ============================================================================
function renderAllCatalogs(searchKeyword = "") {
  const kw = (searchKeyword || "").trim().toLowerCase();

  const racingList = horsesData.filter(
    h => h.category === "racing" && (!kw || h.breed.toLowerCase().includes(kw) || (h.description || "").toLowerCase().includes(kw))
  );
  const showList = horsesData.filter(
    h => h.category === "show" && (!kw || h.breed.toLowerCase().includes(kw) || (h.description || "").toLowerCase().includes(kw))
  );
  const feedList = otherProductsData.filter(
    p => p.category === "feed" && (!kw || p.name.toLowerCase().includes(kw) || (p.description || "").toLowerCase().includes(kw))
  );
  const equipList = otherProductsData.filter(
    p => p.category === "equipment" && (!kw || p.name.toLowerCase().includes(kw) || (p.description || "").toLowerCase().includes(kw))
  );

  const racingGrid = document.getElementById("racingHorseGrid");
  const showGrid = document.getElementById("showHorseGrid");
  const feedGrid = document.getElementById("feedProductGrid");
  const equipGrid = document.getElementById("equipmentProductGrid");

  if (racingGrid) {
    racingGrid.innerHTML = racingList.length
      ? racingList.map(h => createHorseCardHTML(h)).join("")
      : `<p class="col-span-full text-sm text-gray-400 py-4">ไม่พบรายการม้าแข่งในหมวดนี้</p>`;
  }

  if (showGrid) {
    showGrid.innerHTML = showList.length
      ? showList.map(h => createHorseCardHTML(h)).join("")
      : `<p class="col-span-full text-sm text-gray-400 py-4">ไม่พบรายการม้าสวยงามในหมวดนี้</p>`;
  }

  if (feedGrid) {
    feedGrid.innerHTML = feedList.length
      ? feedList.map(p => createOtherProductCardHTML(p)).join("")
      : `<p class="col-span-full text-sm text-gray-400 py-4">ไม่พบรายการอาหารสัตว์ในหมวดนี้</p>`;
  }

  if (equipGrid) {
    equipGrid.innerHTML = equipList.length
      ? equipList.map(p => createOtherProductCardHTML(p)).join("")
      : `<p class="col-span-full text-sm text-gray-400 py-4">ไม่พบรายการอุปกรณ์เสริมในหมวดนี้</p>`;
  }
}

function createHorseCardHTML(horse) {
  const coverImg = (horse.images && horse.images[0]) || "";
  const sireStock = horse.variants?.sire?.stock ?? 0;
  const damStock = horse.variants?.dam?.stock ?? 0;
  const totalStock = Number(sireStock) + Number(damStock);
  const isOut = totalStock <= 0;

  return `
    <div
      onclick="openProductDetailModal('horse', '${horse.id}')"
      class="bg-black rounded-3xl overflow-hidden border border-white/10 shadow-xl cursor-pointer group hover:border-hbGold/60 transition duration-300 flex flex-col justify-between"
    >
      <div class="relative aspect-square overflow-hidden bg-zinc-800">
        <img
          src="${coverImg}"
          alt="${horse.breed}"
          class="w-full h-full object-cover group-hover:scale-105 transition duration-500 ${isOut ? 'grayscale opacity-50' : ''}"
        />
        <span class="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold ${isOut ? 'bg-red-600 text-white' : 'bg-black/75 text-white'}">
          ${isOut ? 'สินค้าหมด' : `คงเหลือ ${totalStock} ตัว`}
        </span>
      </div>
      <div class="p-4 text-center">
        <h3 class="font-extrabold text-sm sm:text-base text-white group-hover:text-hbOrange transition uppercase truncate">
          ${horse.breed}
        </h3>
        <p class="text-xs sm:text-sm text-gray-200 mt-1 font-semibold">${horse.priceRange}</p>
      </div>
    </div>
  `;
}

function createOtherProductCardHTML(item) {
  const isOut = Number(item.stock) <= 0;
  const unitName = item.unit || "ชิ้น";

  return `
    <div class="bg-zinc-950 rounded-3xl overflow-hidden border border-white/10 shadow-xl flex flex-col justify-between group hover:border-hbGold/50 transition duration-300">
      <div>
        <div onclick="openProductDetailModal('other', '${item.id}')" class="relative h-56 overflow-hidden bg-white cursor-pointer">
          <img
            src="${item.image}"
            alt="${item.name}"
            class="w-full h-full object-cover group-hover:scale-105 transition duration-500 ${isOut ? 'grayscale opacity-50' : ''}"
          />
          <span class="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold ${isOut ? 'bg-red-600 text-white' : 'bg-black/80 text-white'}">
            ${isOut ? 'สินค้าหมด' : `คงเหลือ ${item.stock} ${unitName}`}
          </span>
        </div>
        <div class="p-5">
          <h4 onclick="openProductDetailModal('other', '${item.id}')" class="font-bold text-base sm:text-lg text-white group-hover:text-hbGold transition line-clamp-2 cursor-pointer">
            ${item.name}
          </h4>
          <p class="text-xs text-gray-300 mt-2 line-clamp-2">${item.description || ""}</p>
        </div>
      </div>
      <div class="px-5 pb-5 pt-3 border-t border-white/10 flex items-center justify-between">
        <span class="text-hbOrange font-extrabold text-lg sm:text-xl">${formatTHB(item.price)}</span>
        <button
          type="button"
          onclick="openProductDetailModal('other', '${item.id}')"
          class="text-xs font-bold text-hbGold underline hover:text-hbOrange"
        >
          ดูรายละเอียด
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// 3. ระบบค้นหาสินค้า และตรวจจับโค้ดลับ CODENAME:UMA.ADMIN
// ============================================================================
function setupSearchEnterListener() {
  const searchInput = document.getElementById("globalSearchInput");
  if (!searchInput) return;
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleGlobalSearch();
    }
  });
}

function handleGlobalSearch() {
  const searchInput = document.getElementById("globalSearchInput");
  if (!searchInput) return;
  const raw = searchInput.value.trim();

  // ตรวจจับโค้ดลับเข้าสู่ระบบแอดมิน
  if (raw.toUpperCase().replace(/\s+/g, "") === "CODENAME:UMA.ADMIN") {
    searchInput.value = "";
    document.getElementById("admLoginUser").value = "";
    document.getElementById("admLoginPass").value = "";
    document.getElementById("admLoginErrorMsg").classList.add("hidden");
    document.getElementById("adminLoginStep1").classList.remove("hidden");
    document.getElementById("adminLoginStep2Otp").classList.add("hidden");
    openModal("adminSecretLoginModal");
    return;
  }

  renderAllCatalogs(raw);
  const firstSection = document.getElementById("sectionRacing");
  if (firstSection && raw) {
    firstSection.scrollIntoView({ behavior: "smooth" });
  }
}

async function handleAdminSecretLogin(event) {
  event.preventDefault();
  const username = document.getElementById("admLoginUser").value.trim();
  const password = document.getElementById("admLoginPass").value;
  const errEl = document.getElementById("admLoginErrorMsg");

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "USERNAME หรือ PASSWORD ของแอดมินไม่ถูกต้อง";
      errEl.classList.remove("hidden");
      return;
    }

    pendingAdminToken = data.tempToken;
    document.getElementById("adminLoginStep1").classList.add("hidden");
    document.getElementById("adminLoginStep2Otp").classList.remove("hidden");
    document.getElementById("admOtpSentInfo").textContent = data.emailNotice || "กรุณากรอกรหัส OTP 6 หลัก";
    document.getElementById("admDemoOtpValue").textContent = data.demoOtp || "------";
    document.getElementById("admOtpInput").value = "";
    document.getElementById("admOtpErrorMsg").classList.add("hidden");
  } catch (err) {
    errEl.textContent = "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้";
    errEl.classList.remove("hidden");
  }
}

async function handleAdminOtpVerify(event) {
  event.preventDefault();
  const otp = document.getElementById("admOtpInput").value.trim();
  const errEl = document.getElementById("admOtpErrorMsg");

  try {
    const res = await fetch("/api/admin/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tempToken: pendingAdminToken, otp })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "รหัส OTP ไม่ถูกต้อง";
      errEl.classList.remove("hidden");
      return;
    }

    sessionStorage.setItem("hb_admin_session", JSON.stringify(data.admin));
    closeModal("adminSecretLoginModal");
    window.location.href = "/admin";
  } catch (err) {
    errEl.textContent = "เกิดข้อผิดพลาดในการตรวจสอบ OTP";
    errEl.classList.remove("hidden");
  }
}

// ============================================================================
// 4. หน้าต่างดูรายละเอียดม้าและสินค้า (Product Detail Modal)
// ============================================================================
function openProductDetailModal(type, id) {
  currentDetailType = type;
  currentDetailId = id;
  currentDetailQty = 1;
  document.getElementById("detailBuyQty").textContent = "1";

  const horseVariantBox = document.getElementById("detailHorseVariantSection");
  const vaccineBox = document.getElementById("detailVaccineBox");
  const thumbsBox = document.getElementById("detailThumbnails");
  const unitLabel = document.getElementById("detailUnitLabel");

  if (type === "horse") {
    const horse = horsesData.find(h => h.id === id);
    if (!horse) return;

    document.getElementById("detailCategoryBadge").textContent =
      horse.category === "racing" ? "RACING HORSE" : "SHOW HORSE";
    document.getElementById("detailTitle").textContent = horse.breed;
    document.getElementById("detailRatingStars").textContent = `★★★★★ (${Number(horse.rating || 5).toFixed(1)})`;
    document.getElementById("detailDescription").textContent = horse.description || "";
    document.getElementById("detailVaccineText").textContent =
      horse.vaccineInfo ||
      "วัคซีนไข้หวัดม้า (Equine Influenza), วัคซีนโรคบาดทะยัก (Tetanus), วัคซีนโรคเยื่อหุ้มสมองอักเสบ (JE), วัคซีนโรคพิษสุนัขบ้า (Rabies)";

    const imgs = Array.isArray(horse.images) && horse.images.length ? horse.images : [""];
    document.getElementById("detailMainImage").src = imgs[0];
    thumbsBox.innerHTML = imgs
      .map(
        imgUrl => `
        <img
          src="${imgUrl}"
          onclick="document.getElementById('detailMainImage').src='${imgUrl}'"
          class="aspect-square rounded-xl object-cover border border-white/20 cursor-pointer hover:border-hbOrange transition"
        />
      `
      )
      .join("");

    horseVariantBox.classList.remove("hidden");
    vaccineBox.classList.remove("hidden");
    unitLabel.textContent = "ตัว";

    selectHorseVariant("sire");
    renderDetailReviews(horse.reviews || []);
  } else {
    const prod = otherProductsData.find(p => p.id === id);
    if (!prod) return;

    const unitName = prod.unit || "ชิ้น";
    document.getElementById("detailCategoryBadge").textContent =
      prod.category === "feed" ? "HORSE FEED (อาหารสัตว์)" : "ACCESSORIES (อุปกรณ์ม้า)";
    document.getElementById("detailTitle").textContent = prod.name;
    document.getElementById("detailRatingStars").textContent = `★★★★★ (${Number(prod.rating || 5).toFixed(1)})`;
    document.getElementById("detailPriceText").textContent = formatTHB(prod.price);
    document.getElementById("detailDescription").textContent = prod.description || "";
    document.getElementById("detailMainImage").src = prod.image || "";
    thumbsBox.innerHTML = "";

    const stockBadge = document.getElementById("detailStockBadge");
    if (prod.stock > 0) {
      stockBadge.textContent = `คงเหลือ ${prod.stock} ${unitName}`;
      stockBadge.className = "px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold";
    } else {
      stockBadge.textContent = `สินค้าหมด (0 ${unitName})`;
      stockBadge.className = "px-2.5 py-0.5 rounded-full bg-red-600/20 text-red-400 text-xs font-bold";
    }

    horseVariantBox.classList.add("hidden");
    vaccineBox.classList.add("hidden");
    unitLabel.textContent = unitName;

    renderDetailReviews(prod.reviews || []);
  }

  openModal("productDetailModal");
}

function selectHorseVariant(variantKey) {
  currentDetailVariant = variantKey;
  currentDetailQty = 1;
  document.getElementById("detailBuyQty").textContent = "1";

  const horse = horsesData.find(h => h.id === currentDetailId);
  if (!horse) return;

  const vData = (horse.variants && horse.variants[variantKey]) || {
    label: variantKey === "sire" ? "พ่อพันธุ์" : "แม่พันธุ์",
    horseName: horse.breed,
    age: "4 ปี",
    health: "แข็งแรงสมบูรณ์",
    price: 250000,
    stock: 1
  };

  const btnSire = document.getElementById("variantBtnSire");
  const btnDam = document.getElementById("variantBtnDam");
  if (variantKey === "sire") {
    btnSire.className = "py-2 px-4 rounded-xl font-bold text-sm border-2 border-hbOrange bg-hbOrange text-white transition";
    btnDam.className = "py-2 px-4 rounded-xl font-bold text-sm border-2 border-white/20 bg-transparent text-gray-300 hover:border-hbGold transition";
  } else {
    btnDam.className = "py-2 px-4 rounded-xl font-bold text-sm border-2 border-hbOrange bg-hbOrange text-white transition";
    btnSire.className = "py-2 px-4 rounded-xl font-bold text-sm border-2 border-white/20 bg-transparent text-gray-300 hover:border-hbGold transition";
  }

  document.getElementById("detailPriceText").textContent = formatTHB(vData.price);
  document.getElementById("detailHorseName").textContent = vData.horseName || horse.breed;
  document.getElementById("detailHorseAge").textContent = vData.age || "4 ปี";
  document.getElementById("detailHorseHealth").textContent = vData.health || "แข็งแรงสมบูรณ์";

  const stockBadge = document.getElementById("detailStockBadge");
  if (Number(vData.stock) > 0) {
    stockBadge.textContent = `คงเหลือ ${vData.stock} ตัว`;
    stockBadge.className = "px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold";
  } else {
    stockBadge.textContent = "สินค้าหมด (0 ตัว)";
    stockBadge.className = "px-2.5 py-0.5 rounded-full bg-red-600/20 text-red-400 text-xs font-bold";
  }
}

function getDetailMaxStock() {
  if (currentDetailType === "horse") {
    const horse = horsesData.find(h => h.id === currentDetailId);
    return Number(horse?.variants?.[currentDetailVariant]?.stock || 0);
  }
  const prod = otherProductsData.find(p => p.id === currentDetailId);
  return Number(prod?.stock || 0);
}

function adjustDetailQty(delta) {
  const maxStock = getDetailMaxStock();
  if (maxStock <= 0) {
    showToast("สินค้านี้หมดชั่วคราว");
    return;
  }
  const next = currentDetailQty + delta;
  if (next < 1) return;
  if (next > maxStock) {
    showToast(`มีสินค้าคงเหลือสูงสุด ${maxStock}`);
    return;
  }
  currentDetailQty = next;
  document.getElementById("detailBuyQty").textContent = String(currentDetailQty);
}

function buildCurrentDetailOrderItem() {
  if (currentDetailType === "horse") {
    const horse = horsesData.find(h => h.id === currentDetailId);
    if (!horse) return null;
    const vData = horse.variants?.[currentDetailVariant];
    if (!vData || Number(vData.stock) <= 0) {
      showToast("ม้าประเภทที่เลือกสินค้าหมดชั่วคราว");
      return null;
    }
    const label = currentDetailVariant === "sire" ? "พ่อพันธุ์" : "แม่พันธุ์";
    return {
      cartId: `horse-${horse.id}-${currentDetailVariant}`,
      type: "horse",
      refId: horse.id,
      variantKey: currentDetailVariant,
      title: `${horse.breed} (${label} - ${vData.horseName})`,
      price: Number(vData.price),
      qty: currentDetailQty,
      maxStock: Number(vData.stock),
      unit: "ตัว",
      image: (horse.images && horse.images[0]) || ""
    };
  } else {
    const prod = otherProductsData.find(p => p.id === currentDetailId);
    if (!prod || Number(prod.stock) <= 0) {
      showToast("สินค้านี้หมดชั่วคราว");
      return null;
    }
    return {
      cartId: `other-${prod.id}`,
      type: "other",
      refId: prod.id,
      variantKey: "",
      title: prod.name,
      price: Number(prod.price),
      qty: currentDetailQty,
      maxStock: Number(prod.stock),
      unit: prod.unit || "ชิ้น",
      image: prod.image || ""
    };
  }
}

function renderDetailReviews(reviews) {
  const container = document.getElementById("detailReviewsList");
  if (!container) return;
  if (!reviews || reviews.length === 0) {
    container.innerHTML = `<p class="text-xs text-gray-500">ยังไม่มีรีวิวสำหรับสินค้านี้</p>`;
    return;
  }
  container.innerHTML = reviews
    .map(
      r => `
      <div class="bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-bold text-white">${r.user}</span>
          <span class="text-hbGold">${"★".repeat(Number(r.stars || 5))}</span>
        </div>
        <p class="text-gray-300 mt-1">${r.comment}</p>
        <p class="text-[10px] text-gray-500 mt-0.5">${r.date || ""}</p>
      </div>
    `
    )
    .join("");
}

// ============================================================================
// 5. ระบบตะกร้าสินค้า (Cart) และการกดซื้อทันที (BUY)
// ============================================================================
function requireLoginFirst() {
  if (!currentUser) {
    openAuthModal("login");
    showToast("กรุณาเข้าสู่ระบบก่อนทำรายการสั่งซื้อ");
    return false;
  }
  return true;
}

function addCurrentDetailToCart() {
  if (!requireLoginFirst()) return;
  const item = buildCurrentDetailOrderItem();
  if (!item) return;

  const existing = cart.find(c => c.cartId === item.cartId);
  if (existing) {
    existing.qty = Math.min(item.maxStock, existing.qty + item.qty);
  } else {
    cart.push({ ...item, selected: true });
  }

  saveUserSession();
  updateCartBadgeUI();
  closeModal("productDetailModal");
  showToast(`เพิ่ม "${item.title}" ลงในตะกร้าแล้ว`);
}

function buyNowFromDetail() {
  if (!requireLoginFirst()) return;
  const item = buildCurrentDetailOrderItem();
  if (!item) return;
  closeModal("productDetailModal");
  openCheckoutModal([item]);
}

function updateCartBadgeUI() {
  const badge = document.getElementById("cartCountBadge");
  if (!badge) return;
  const totalCount = cart.reduce((s, i) => s + Number(i.qty || 0), 0);
  badge.textContent = String(totalCount);
  if (totalCount > 0) {
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function openCartModal() {
  if (!requireLoginFirst()) return;
  renderCartModalItems();
  openModal("cartModal");
}

function renderCartModalItems() {
  const container = document.getElementById("cartItemsContainer");
  const totalEl = document.getElementById("cartTotalAmount");
  if (!container || !totalEl) return;

  if (cart.length === 0) {
    container.innerHTML = `<p class="text-center text-sm text-gray-400 py-10">ไม่มีสินค้าในตะกร้าของคุณ</p>`;
    totalEl.textContent = "0 ฿";
    return;
  }

  container.innerHTML = cart
    .map(
      (item, idx) => `
      <div class="bg-black/50 border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <input
            type="checkbox"
            ${item.selected !== false ? "checked" : ""}
            onchange="toggleCartItemSelect(${idx}, this.checked)"
            class="w-4 h-4 accent-hbOrange rounded cursor-pointer"
          />
          <img src="${item.image}" class="w-14 h-14 rounded-xl object-cover bg-zinc-800 shrink-0" />
          <div>
            <h4 class="font-bold text-xs sm:text-sm text-white line-clamp-1">${item.title}</h4>
            <p class="text-xs text-hbOrange font-bold mt-0.5">${formatTHB(item.price)} / ${item.unit || "ชิ้น"}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="changeCartItemQty(${idx}, -1)" class="w-6 h-6 rounded-full bg-white/10 hover:bg-hbOrange text-xs font-bold">-</button>
          <span class="text-xs font-bold w-6 text-center">${item.qty}</span>
          <button onclick="changeCartItemQty(${idx}, 1)" class="w-6 h-6 rounded-full bg-white/10 hover:bg-hbOrange text-xs font-bold">+</button>
          <button onclick="removeCartItem(${idx})" class="ml-1 text-red-400 hover:text-red-300 text-xs">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `
    )
    .join("");

  const sum = cart
    .filter(i => i.selected !== false)
    .reduce((acc, i) => acc + i.price * i.qty, 0);
  totalEl.textContent = formatTHB(sum);
}

function toggleCartItemSelect(idx, checked) {
  if (cart[idx]) cart[idx].selected = checked;
  saveUserSession();
  renderCartModalItems();
}

function changeCartItemQty(idx, delta) {
  const item = cart[idx];
  if (!item) return;
  const next = item.qty + delta;
  if (next < 1) return;
  if (next > item.maxStock) {
    showToast(`มีสินค้าคงเหลือสูงสุด ${item.maxStock} ${item.unit || "ชิ้น"}`);
    return;
  }
  item.qty = next;
  saveUserSession();
  updateCartBadgeUI();
  renderCartModalItems();
}

function removeCartItem(idx) {
  cart.splice(idx, 1);
  saveUserSession();
  updateCartBadgeUI();
  renderCartModalItems();
}

function proceedCartToCheckout() {
  const selectedItems = cart.filter(i => i.selected !== false);
  if (selectedItems.length === 0) {
    showToast("กรุณาเลือกสินค้าในตะกร้าอย่างน้อย 1 รายการ");
    return;
  }
  closeModal("cartModal");
  openCheckoutModal(selectedItems);
}

// ============================================================================
// 6. ระบบชำระเงิน 3 ขั้นตอน (ตัวเลือกจัดส่ง -> ชำระเงิน -> สรุปคำสั่งซื้อ)
// ============================================================================
function hasHorseInCheckoutItems() {
  return checkoutItems.some(item => item.type === "horse");
}

async function openCheckoutModal(items) {
  if (!requireLoginFirst()) return;

  if (Array.isArray(items) && items.length > 0) {
    checkoutItems = items.map(i => ({ ...i }));
  } else if (items && typeof items === "object" && !Array.isArray(items) && items.title) {
    checkoutItems = [{ ...items }];
  } else if (!checkoutItems || checkoutItems.length === 0) {
    const selectedInCart = cart.filter(i => i.selected !== false);
    checkoutItems = selectedInCart.map(i => ({ ...i }));
  }

  if (!checkoutItems || checkoutItems.length === 0) {
    showToast("ไม่มีรายการสินค้าสำหรับชำระเงิน");
    return;
  }

  try {
    const res = await fetch(`/api/profile/full?email=${encodeURIComponent(currentUser.email)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.user) {
        currentUser = { ...currentUser, ...data.user };
        saveUserSession();
      }
    }
  } catch (e) {}

  selectedPaymentMethod = "qr";

  const userScope = currentUser?.country_type || "ในประเทศ";
  const userDistKm = Number(currentUser?.distance_km || 0);
  const userFullAddr = currentUser?.address || "";

  // 1. การจัดส่ง (ล็อกไว้ให้ตรวจสอบว่าในประเทศหรือต่างประเทศ)
  document.getElementById("chkCountryScope").value = userScope;
  // 4. ระยะทางจัดส่ง (ล็อกตามหมุดที่ปักไว้)
  document.getElementById("chkDistanceDisplay").value = `${userDistKm.toLocaleString("th-TH")} KM.`;
  // 5. ที่อยู่ของคุณ (แก้ไขได้)
  document.getElementById("chkEditableAddress").value = userFullAddr;
  document.getElementById("chkAgreeShippingTerms").checked = false;
  document.getElementById("chkStep1Error").classList.add("hidden");

  const noPinWarn = document.getElementById("chkNoPinWarning");
  if (userDistKm <= 0) {
    noPinWarn.classList.remove("hidden");
  } else {
    noPinWarn.classList.add("hidden");
  }

  const transportSelect = document.getElementById("chkTransportMode");
  const transportArrow = document.getElementById("chkTransportArrow");
  const stallSelect = document.getElementById("chkStallType");
  const stallArrow = document.getElementById("chkStallArrow");
  const isHorseOrder = hasHorseInCheckoutItems();

  if (!isHorseOrder) {
    transportSelect.innerHTML = `<option value="parcel">ขนส่งพัสดุมาตรฐาน (อาหาร/อุปกรณ์ม้า เหมาจ่าย 50 บาท)</option>`;
    transportSelect.disabled = true;
    if (transportArrow) transportArrow.classList.add("hidden");

    stallSelect.innerHTML = `<option value="none">ไม่ใช้คอกม้า (สินค้าทั่วไป)</option>`;
    stallSelect.disabled = true;
    if (stallArrow) stallArrow.classList.add("hidden");
  } else {
    // 3. ตัวเลือกคอกม้าขนส่ง (เหมือนกันทั้งบกและอากาศ: รวมคอก 3 ตัว, แยกคอก 1 ตัว, VIP)
    stallSelect.disabled = false;
    if (stallArrow) stallArrow.classList.remove("hidden");
    stallSelect.innerHTML = `
      <option value="shared">รวมคอก (3 ตัวต่อคอก - ราคาต่ำสุด)</option>
      <option value="single">แยกคอก (1 ตัวต่อคอก - ราคากลาง)</option>
      <option value="vip">VIP (ส่งเฉพาะม้าลูกค้าเท่านั้น)</option>
    `;

    // 2. ตัวเลือกการขนส่ง: ต่างประเทศบังคับเป็นทางอากาศเท่านั้น ส่วนในประเทศเลือกบกหรืออากาศได้
    if (userScope === "ต่างประเทศ") {
      transportSelect.innerHTML = `<option value="air">จัดส่งโดยรถขนส่งม้า Air Horse One Boeing 727</option>`;
      transportSelect.value = "air";
      transportSelect.disabled = true;
      if (transportArrow) transportArrow.classList.add("hidden");
      chkSelectedTransportMode = "air";
    } else {
      transportSelect.innerHTML = `
        <option value="land">จัดส่งโดยรถขนส่งม้า HB</option>
        <option value="air">จัดส่งโดยรถขนส่งม้า Air Horse One Boeing 727</option>
      `;
      transportSelect.value = "land";
      transportSelect.disabled = false;
      if (transportArrow) transportArrow.classList.remove("hidden");
      chkSelectedTransportMode = "land";
    }
  }

  document.getElementById("checkoutStep1").classList.remove("hidden");
  document.getElementById("checkoutStep2").classList.add("hidden");
  document.getElementById("checkoutStep3").classList.add("hidden");

  openModal("checkoutModal");
}

function handleTransportModeChange() {
  chkSelectedTransportMode = document.getElementById("chkTransportMode").value;
  updateCheckoutCalculations();
}

function jumpToProfileAddressPin() {
  closeModal("checkoutModal");
  openProfileModal();
  setTimeout(() => {
    switchProfileSubView("address");
  }, 200);
}

function goToCheckoutStep2() {
  const addr = document.getElementById("chkEditableAddress").value.trim();
  const agreed = document.getElementById("chkAgreeShippingTerms").checked;
  const errEl = document.getElementById("chkStep1Error");

  if (!addr) {
    errEl.textContent = "⚠️ กรุณากรอกหรือตรวจสอบที่อยู่ของคุณในข้อ 5 ก่อนดำเนินการต่อ";
    errEl.classList.remove("hidden");
    return;
  }
  if (!agreed) {
    errEl.textContent = "⚠️ กรุณาติ๊กยอมรับเงื่อนไขการตรวจสอบข้อมูลการจัดส่งก่อนดำเนินการต่อ";
    errEl.classList.remove("hidden");
    return;
  }

  errEl.classList.add("hidden");
  chkSelectedTransportMode = document.getElementById("chkTransportMode").value;
  chkSelectedStallType = document.getElementById("chkStallType").value;

  document.getElementById("checkoutStep1").classList.add("hidden");
  document.getElementById("checkoutStep2").classList.remove("hidden");
  document.getElementById("checkoutStep3").classList.add("hidden");
  selectPaymentMethodOption(selectedPaymentMethod || "qr");
}

function backToCheckoutStep1() {
  document.getElementById("checkoutStep1").classList.remove("hidden");
  document.getElementById("checkoutStep2").classList.add("hidden");
  document.getElementById("checkoutStep3").classList.add("hidden");
}

function selectPaymentMethodOption(method) {
  selectedPaymentMethod = method;
  const dotQr = document.getElementById("radioDotQr");
  const dotBank = document.getElementById("radioDotBank");
  const qrBox = document.getElementById("qrCodePreviewBox");
  const bankBox = document.getElementById("bankInfoPreviewBox");

  if (method === "qr") {
    dotQr.className = "w-6 h-6 rounded-full border-4 border-green-500 bg-white";
    dotBank.className = "w-6 h-6 rounded-full border-4 border-gray-400 bg-white";
    qrBox.classList.remove("hidden");
    bankBox.classList.add("hidden");
  } else {
    dotQr.className = "w-6 h-6 rounded-full border-4 border-gray-400 bg-white";
    dotBank.className = "w-6 h-6 rounded-full border-4 border-green-500 bg-white";
    qrBox.classList.add("hidden");
    bankBox.classList.remove("hidden");
  }
}

function goToCheckoutStep3() {
  document.getElementById("checkoutStep1").classList.add("hidden");
  document.getElementById("checkoutStep2").classList.add("hidden");
  document.getElementById("checkoutStep3").classList.remove("hidden");

  const slipInput = document.getElementById("paymentSlipFile");
  if (slipInput) slipInput.value = "";
  const slipLabel = document.getElementById("slipFileNameLabel");
  if (slipLabel) slipLabel.textContent = "No file chosen";

  updateCheckoutCalculations();
}

function backToCheckoutStep2() {
  document.getElementById("checkoutStep1").classList.add("hidden");
  document.getElementById("checkoutStep2").classList.remove("hidden");
  document.getElementById("checkoutStep3").classList.add("hidden");
}

function updateSlipFilenameDisplay(inputEl) {
  const labelEl = document.getElementById("slipFileNameLabel");
  if (inputEl.files && inputEl.files[0]) {
    labelEl.textContent = inputEl.files[0].name;
    labelEl.classList.remove("text-gray-500");
    labelEl.classList.add("text-zinc-900", "font-semibold");
  } else {
    labelEl.textContent = "No file chosen";
  }
}

function toggleFeeTooltip(boxId) {
  const box = document.getElementById(boxId);
  if (box) box.classList.toggle("hidden");
}

function adjustCheckoutItemQty(idx, delta) {
  const item = checkoutItems[idx];
  if (!item) return;
  const nextQty = item.qty + delta;
  if (nextQty < 1) return;
  if (nextQty > item.maxStock) {
    showToast(`สินค้ามีจำนวนจำกัด (${item.maxStock})`);
    return;
  }
  item.qty = nextQty;
  updateCheckoutCalculations();
}

function getCheckoutTotals() {
  const subtotal = checkoutItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const userScope = document.getElementById("chkCountryScope")?.value || "ในประเทศ";
  const distanceKm = Number(currentUser?.distance_km || 0);
  const mode = document.getElementById("chkTransportMode")?.value || chkSelectedTransportMode;
  const stall = document.getElementById("chkStallType")?.value || chkSelectedStallType;
  const isHorseOrder = hasHorseInCheckoutItems();

  let shippingCost = 0;
  let travelExpense = 0;
  let docFee = 0;
  let insuranceFee = 0;

  if (!isHorseOrder) {
    shippingCost = 50;
  } else {
    if (mode === "land") {
      const baseTruck = 3500;
      const distCost = stall === "vip" ? 0 : distanceKm * 30;
      const stallCost = stall === "shared" ? 2500 : stall === "single" ? 4500 : 16000;
      shippingCost = baseTruck + distCost + stallCost;
    } else {
      const basePlane = 150000;
      const distCost = stall === "vip" ? 0 : distanceKm * 50;
      const stallCost = stall === "shared" ? 100000 : stall === "single" ? 350000 : 777000;
      shippingCost = basePlane + distCost + stallCost;
    }

    travelExpense = 1600 + 1000 + 14000 + (userScope === "ต่างประเทศ" ? 300000 : 0);
    docFee = 7600 + 23600;
    insuranceFee = Math.round(subtotal * 0.015);
  }

  const totalBeforeVat = subtotal + shippingCost + travelExpense + docFee + insuranceFee;
  const vat = Math.round(totalBeforeVat * 0.07);
  const grandTotal = totalBeforeVat + vat;

  return {
    subtotal,
    shippingCost,
    travelExpense,
    docFee,
    insuranceFee,
    vat,
    grandTotal,
    userScope,
    distanceKm,
    mode,
    stall,
    isHorseOrder
  };
}

function updateCheckoutCalculations() {
  const calc = getCheckoutTotals();

  document.getElementById("chkSummaryTitleScope").textContent =
    calc.userScope === "ต่างประเทศ" ? "สรุปคำสั่งซื้อ (ต่างประเทศ)" : "สรุปคำสั่งซื้อ (ภายในประเทศ)";
  document.getElementById("chkSummaryMethodLabel").textContent =
    selectedPaymentMethod === "qr" ? "QR PROMPTPAY" : "โมบายแบงก์กิ้ง";

  const itemsContainer = document.getElementById("chkSummaryItemsList");
  itemsContainer.innerHTML = checkoutItems
    .map(
      (item, idx) => `
      <div class="flex items-center justify-between gap-2">
        <div class="flex-1">
          <span class="font-medium">• ${item.title} (x${item.qty} ${item.unit || "ชิ้น"})</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="font-semibold text-zinc-900">${formatTHB(item.price * item.qty)}</span>
          <div class="flex flex-col bg-white border border-gray-300 rounded px-1 py-0.5 text-[9px] leading-none">
            <button type="button" onclick="adjustCheckoutItemQty(${idx}, 1)" class="hover:text-hbOrange pb-0.5"><i class="fa-solid fa-caret-up"></i></button>
            <button type="button" onclick="adjustCheckoutItemQty(${idx}, -1)" class="hover:text-hbOrange"><i class="fa-solid fa-caret-down"></i></button>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  const rowTravel = document.getElementById("chkRowTravelExpense");
  const rowDoc = document.getElementById("chkRowDocFee");
  const rowIns = document.getElementById("chkRowInsurance");
  const quarantineRow = document.getElementById("tooltipQuarantineRow");

  if (!calc.isHorseOrder) {
    rowTravel.classList.add("hidden");
    rowDoc.classList.add("hidden");
    rowIns.classList.add("hidden");
    document.getElementById("chkShippingSubLabel").textContent = "(พัสดุอาหาร/อุปกรณ์ม้า เหมาจ่าย 50 ฿)";
  } else {
    rowTravel.classList.remove("hidden");
    rowDoc.classList.remove("hidden");
    rowIns.classList.remove("hidden");

    const modeName = calc.mode === "land" ? "รถขนส่งม้า HB" : "Air Horse One Boeing 727,747";
    const stallName = calc.stall === "shared" ? "รวมคอก" : calc.stall === "single" ? "แยกคอก" : "VIP เหมา";
    document.getElementById("chkShippingSubLabel").textContent = `(${modeName} • ${stallName} • ${calc.distanceKm} กม.)`;

    if (calc.userScope === "ต่างประเทศ") {
      quarantineRow.classList.remove("hidden");
    } else {
      quarantineRow.classList.add("hidden");
    }
  }

  document.getElementById("chkSumSubtotal").textContent = formatTHB(calc.subtotal);
  document.getElementById("chkSumShipping").textContent = formatTHB(calc.shippingCost);
  document.getElementById("chkSumTravelExpense").textContent = formatTHB(calc.travelExpense);
  document.getElementById("chkSumDocFee").textContent = formatTHB(calc.docFee);
  document.getElementById("chkSumInsurance").textContent = formatTHB(calc.insuranceFee);
  document.getElementById("chkSumVat").textContent = formatTHB(calc.vat);
  document.getElementById("chkSumGrandTotal").textContent = formatTHB(calc.grandTotal);
  document.getElementById("chkSumPayNow").textContent = formatTHB(calc.grandTotal);
}

async function submitFinalOrder(event) {
  event.preventDefault();
  const calc = getCheckoutTotals();
  const address = document.getElementById("chkEditableAddress").value.trim();

  const slipFile = document.getElementById("paymentSlipFile").files[0];
  let slipBase64 = "slip_uploaded.jpg";
  if (slipFile) {
    slipBase64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(slipFile);
    });
  }

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userEmail: currentUser.email,
        paymentMethod: selectedPaymentMethod,
        installmentMonths: 0,
        subtotal: calc.subtotal,
        vat: calc.vat,
        grandTotal: calc.grandTotal,
        paidNow: calc.grandTotal,
        monthlyInstallment: 0,
        slipImage: slipBase64,
        shippingAddress: address,
        shippingScope: calc.userScope,
        transportMode: calc.mode,
        stallType: calc.stall,
        distanceKm: calc.distanceKm,
        shippingCost: calc.shippingCost,
        travelExpense: calc.travelExpense,
        docFee: calc.docFee,
        insuranceFee: calc.insuranceFee,
        items: checkoutItems
      })
    });
    const result = await res.json();
    const orderNo = result.orderNumber || "HB-" + Math.floor(100000 + Math.random() * 900000);

    const boughtSet = new Set(checkoutItems.map(i => i.cartId));
    cart = cart.filter(i => !boughtSet.has(i.cartId));
    saveUserSession();
    updateCartBadgeUI();

    await loadInitialData();
    await refreshUnreadNotificationBadge();
    closeModal("checkoutModal");

    const methodLabel = selectedPaymentMethod === "qr" ? "QR PROMPTPAY" : "โมบายแบงก์กิ้ง";
    showReceiptModalWithDownload({
      orderNo,
      username: currentUser.username,
      phone: currentUser.phone,
      methodLabel,
      address,
      statusLabel: "รอแอดมินอนุมัติคำสั่งซื้อ",
      items: checkoutItems,
      subtotal: calc.subtotal,
      shippingCost: calc.shippingCost,
      travelExpense: calc.travelExpense,
      docFee: calc.docFee,
      insuranceFee: calc.insuranceFee,
      vat: calc.vat,
      grandTotal: calc.grandTotal,
      createdAt: new Date().toLocaleString("th-TH")
    });

    showToast("ส่งคำสั่งซื้อเรียบร้อย!");
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการบันทึกคำสั่งซื้อ");
  }
}

function showReceiptModalWithDownload(data) {
  document.getElementById("rcpOrderNo").textContent = `หมายเลขคำสั่งซื้อ: ${data.orderNo}`;
  document.getElementById("rcpDate").textContent = `วันที่ทำรายการ: ${data.createdAt}`;
  document.getElementById("rcpCustomer").textContent = `${data.username} (${data.phone || "-"})`;
  document.getElementById("rcpMethod").textContent = data.methodLabel;
  document.getElementById("rcpAddress").textContent = data.address;
  document.getElementById("rcpStatus").textContent = data.statusLabel;

  document.getElementById("rcpItemsList").innerHTML = data.items
    .map(
      i => `
      <div class="flex justify-between">
        <span>• ${i.title} (x${i.qty})</span>
        <span class="font-bold">${formatTHB(i.price * i.qty)}</span>
      </div>
    `
    )
    .join("");

  const totalFees =
    Number(data.shippingCost || 0) +
    Number(data.travelExpense || 0) +
    Number(data.docFee || 0) +
    Number(data.insuranceFee || 0);

  document.getElementById("rcpSubtotal").textContent = formatTHB(data.subtotal);
  document.getElementById("rcpFees").textContent = formatTHB(totalFees);
  document.getElementById("rcpVat").textContent = formatTHB(data.vat);
  document.getElementById("rcpGrandTotal").textContent = formatTHB(data.grandTotal);

  openModal("receiptModal");
}

function downloadReceiptImage() {
  window.print();
}

// ============================================================================
// 7. ระบบสมาชิก (Login / Register) และจัดการโปรไฟล์ + ปักหมุดแผนที่
// ============================================================================
function loadUserSession() {
  const savedUser = localStorage.getItem("hb_current_user");
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      const savedCart = localStorage.getItem(`hb_cart_${currentUser.email}`);
      cart = savedCart ? JSON.parse(savedCart) : [];
    } catch (e) {
      currentUser = null;
      cart = [];
    }
  }
  updateAuthUI();
  updateCartBadgeUI();
}

function saveUserSession() {
  if (currentUser) {
    localStorage.setItem("hb_current_user", JSON.stringify(currentUser));
    localStorage.setItem(`hb_cart_${currentUser.email}`, JSON.stringify(cart));
  }
}

function updateAuthUI() {
  const guestBox = document.getElementById("guestAuthButtons");
  const userBox = document.getElementById("userProfileMenu");
  if (!guestBox || !userBox) return;

  if (currentUser) {
    guestBox.classList.add("hidden");
    userBox.classList.remove("hidden");
    document.getElementById("navUsername").textContent = currentUser.username;
    document.getElementById("navUserAvatar").src =
      currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`;
  } else {
    guestBox.classList.remove("hidden");
    userBox.classList.add("hidden");
  }
}

function openAuthModal(mode = "login") {
  const loginBox = document.getElementById("loginFormBox");
  const regBox = document.getElementById("registerFormBox");
  document.getElementById("loginErrorMsg").classList.add("hidden");
  document.getElementById("regErrorMsg").classList.add("hidden");

  if (mode === "login") {
    loginBox.classList.remove("hidden");
    regBox.classList.add("hidden");
  } else {
    loginBox.classList.add("hidden");
    regBox.classList.remove("hidden");
  }
  openModal("authModal");
}

async function handleUserLogin(event) {
  event.preventDefault();
  const emailOrUser = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginErrorMsg");

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailOrUser, password })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "Username หรือ Password ไม่ถูกต้อง";
      errEl.classList.remove("hidden");
      return;
    }

    currentUser = data.user;
    const savedCart = localStorage.getItem(`hb_cart_${currentUser.email}`);
    cart = savedCart ? JSON.parse(savedCart) : [];
    saveUserSession();
    updateAuthUI();
    updateCartBadgeUI();
    await refreshUnreadNotificationBadge();
    closeModal("authModal");
    showToast(`ยินดีต้อนรับคุณ ${currentUser.username}`);
  } catch (e) {
    errEl.textContent = "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้";
    errEl.classList.remove("hidden");
  }
}

async function handleUserRegister(event) {
  event.preventDefault();
  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmEl = document.getElementById("regConfirmPassword");
  const confirmPass = confirmEl ? confirmEl.value : password;
  const errEl = document.getElementById("regErrorMsg");

  if (password !== confirmPass) {
    errEl.textContent = "รหัสผ่าน (PASSWORD) และยืนยันรหัสผ่าน (CONFIRM) ไม่ตรงกัน";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, phone, password })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "ไม่สามารถสมัครสมาชิกได้";
      errEl.classList.remove("hidden");
      return;
    }

    currentUser = data.user;
    cart = [];
    saveUserSession();
    updateAuthUI();
    updateCartBadgeUI();
    closeModal("authModal");
    showToast("สมัครสมาชิกและเข้าสู่ระบบสำเร็จ!");
  } catch (e) {
    errEl.textContent = "เกิดข้อผิดพลาดในการสมัครสมาชิก";
    errEl.classList.remove("hidden");
  }
}

// ฟังก์ชันเสริมสำหรับคลิกปุ่ม "คลิกเข้าสู่ระบบด้วยบัญชีตัวอย่าง" หรือปุ่ม Google
async function loginWithDemoCowboy() {
  document.getElementById("loginEmail").value = "cowboy_demo";
  document.getElementById("loginPassword").value = "123456";
  await ensureAndLoginDemoAccount("cowboy_demo", "cowboy_demo@gmail.com", "0812345678", "123456");
}

async function handleGoogleQuickLogin() {
  const email = prompt("กรอก Gmail ของคุณเพื่อเข้าสู่ระบบด้วย Google:", "cowboy_google@gmail.com");
  if (!email) return;
  const uname = email.split("@")[0];
  await ensureAndLoginDemoAccount(uname, email.trim().toLowerCase(), "089" + Math.floor(1000000 + Math.random() * 8999999), "google_auth");
}

async function ensureAndLoginDemoAccount(username, email, phone, password) {
  try {
    let res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    let data = await res.json();

    if (!res.ok || !data.ok) {
      res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, phone, password })
      });
      data = await res.json();
    }

    if (data && data.ok && data.user) {
      currentUser = data.user;
      const savedCart = localStorage.getItem(`hb_cart_${currentUser.email}`);
      cart = savedCart ? JSON.parse(savedCart) : [];
      saveUserSession();
      updateAuthUI();
      updateCartBadgeUI();
      await refreshUnreadNotificationBadge();
      closeModal("authModal");
      showToast(`ยินดีต้อนรับคุณ ${currentUser.username}`);
    }
  } catch (e) {}
}

function handleUserLogout() {
  localStorage.removeItem("hb_current_user");
  currentUser = null;
  cart = [];
  updateAuthUI();
  updateCartBadgeUI();
  closeModal("profileModal");
  showToast("ออกจากระบบเรียบร้อยแล้ว");
}

function openSupportRequestModal() {
  closeModal("authModal");
  openModal("supportRequestModal");
}

async function submitSupportRequest(event) {
  event.preventDefault();
  const email = document.getElementById("supEmailInput").value.trim();
  const reason = document.getElementById("supReasonInput").value;
  const details = document.getElementById("supDetailsInput").value.trim();

  try {
    await fetch("/api/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, reason, details })
    });
    closeModal("supportRequestModal");
    showToast("ส่งคำร้องถึงแอดมินเรียบร้อยแล้ว");
  } catch (e) {
    showToast("ไม่สามารถส่งคำร้องได้");
  }
}

// ============================================================================
// รายชื่อรหัสโทรศัพท์ระหว่างประเทศทั่วโลกตามมาตรฐาน ITU (Country Calling Codes)
// ============================================================================
const ITU_COUNTRY_CALLING_CODES = [
  { code: "+66", iso: "TH", flag: "🇹🇭", name: "ไทย (Thailand)" },
  { code: "+1", iso: "US", flag: "🇺🇸", name: "สหรัฐอเมริกา / แคนาดา (USA/Canada)" },
  { code: "+44", iso: "GB", flag: "🇬🇧", name: "สหราชอาณาจักร (UK)" },
  { code: "+81", iso: "JP", flag: "🇯🇵", name: "ญี่ปุ่น (Japan)" },
  { code: "+86", iso: "CN", flag: "🇨🇳", name: "จีน (China)" },
  { code: "+82", iso: "KR", flag: "🇰🇷", name: "เกาหลีใต้ (South Korea)" },
  { code: "+856", iso: "LA", flag: "🇱🇦", name: "ลาว (Laos)" },
  { code: "+855", iso: "KH", flag: "🇰🇭", name: "กัมพูชา (Cambodia)" },
  { code: "+95", iso: "MM", flag: "🇲🇲", name: "เมียนมา (Myanmar)" },
  { code: "+60", iso: "MY", flag: "🇲🇾", name: "มาเลเซีย (Malaysia)" },
  { code: "+65", iso: "SG", flag: "🇸🇬", name: "สิงคโปร์ (Singapore)" },
  { code: "+84", iso: "VN", flag: "🇻🇳", name: "เวียดนาม (Vietnam)" },
  { code: "+62", iso: "ID", flag: "🇮🇩", name: "อินโดนีเซีย (Indonesia)" },
  { code: "+63", iso: "PH", flag: "🇵🇭", name: "ฟิลิปปินส์ (Philippines)" },
  { code: "+673", iso: "BN", flag: "🇧🇳", name: "บรูไน (Brunei)" },
  { code: "+670", iso: "TL", flag: "🇹🇱", name: "ติมอร์-เลสเต (Timor-Leste)" },
  { code: "+852", iso: "HK", flag: "🇭🇰", name: "ฮ่องกง (Hong Kong)" },
  { code: "+853", iso: "MO", flag: "🇲🇴", name: "มาเก๊า (Macau)" },
  { code: "+886", iso: "TW", flag: "🇹🇼", name: "ไต้หวัน (Taiwan)" },
  { code: "+91", iso: "IN", flag: "🇮🇳", name: "อินเดีย (India)" },
  { code: "+61", iso: "AU", flag: "🇦🇺", name: "ออสเตรเลีย (Australia)" },
  { code: "+64", iso: "NZ", flag: "🇳🇿", name: "นิวซีแลนด์ (New Zealand)" },
  { code: "+33", iso: "FR", flag: "🇫🇷", name: "ฝรั่งเศส (France)" },
  { code: "+49", iso: "DE", flag: "🇩🇪", name: "เยอรมนี (Germany)" },
  { code: "+39", iso: "IT", flag: "🇮🇹", name: "อิตาลี (Italy)" },
  { code: "+34", iso: "ES", flag: "🇪🇸", name: "สเปน (Spain)" },
  { code: "+31", iso: "NL", flag: "🇳🇱", name: "เนเธอร์แลนด์ (Netherlands)" },
  { code: "+41", iso: "CH", flag: "🇨🇭", name: "สวิตเซอร์แลนด์ (Switzerland)" },
  { code: "+46", iso: "SE", flag: "🇸🇪", name: "สวีเดน (Sweden)" },
  { code: "+47", iso: "NO", flag: "🇳🇴", name: "นอร์เวย์ (Norway)" },
  { code: "+45", iso: "DK", flag: "🇩🇰", name: "เดนมาร์ก (Denmark)" },
  { code: "+358", iso: "FI", flag: "🇫🇮", name: "ฟินแลนด์ (Finland)" },
  { code: "+32", iso: "BE", flag: "🇧🇪", name: "เบลเยียม (Belgium)" },
  { code: "+43", iso: "AT", flag: "🇦🇹", name: "ออสเตรีย (Austria)" },
  { code: "+353", iso: "IE", flag: "🇮🇪", name: "ไอร์แลนด์ (Ireland)" },
  { code: "+351", iso: "PT", flag: "🇵🇹", name: "โปรตุเกส (Portugal)" },
  { code: "+30", iso: "GR", flag: "🇬🇷", name: "กรีซ (Greece)" },
  { code: "+48", iso: "PL", flag: "🇵🇱", name: "โปแลนด์ (Poland)" },
  { code: "+420", iso: "CZ", flag: "🇨🇿", name: "เช็กเกีย (Czechia)" },
  { code: "+36", iso: "HU", flag: "🇭🇺", name: "ฮังการี (Hungary)" },
  { code: "+7", iso: "RU", flag: "🇷🇺", name: "รัสเซีย / คาซัคสถาน (Russia/Kazakhstan)" },
  { code: "+380", iso: "UA", flag: "🇺🇦", name: "ยูเครน (Ukraine)" },
  { code: "+90", iso: "TR", flag: "🇹🇷", name: "ตุรกี (Turkey)" },
  { code: "+971", iso: "AE", flag: "🇦🇪", name: "สหรัฐอาหรับเอมิเรตส์ (UAE)" },
  { code: "+966", iso: "SA", flag: "🇸🇦", name: "ซาอุดีอาระเบีย (Saudi Arabia)" },
  { code: "+974", iso: "QA", flag: "🇶🇦", name: "กาตาร์ (Qatar)" },
  { code: "+965", iso: "KW", flag: "🇰🇼", name: "คูเวต (Kuwait)" },
  { code: "+973", iso: "BH", flag: "🇧🇭", name: "บาห์เรน (Bahrain)" },
  { code: "+968", iso: "OM", flag: "🇴🇲", name: "โอมาน (Oman)" },
  { code: "+972", iso: "IL", flag: "🇮🇱", name: "อิสราเอล (Israel)" },
  { code: "+962", iso: "JO", flag: "🇯🇴", name: "จอร์แดน (Jordan)" },
  { code: "+98", iso: "IR", flag: "🇮🇷", name: "อิหร่าน (Iran)" },
  { code: "+92", iso: "PK", flag: "🇵🇰", name: "ปากีสถาน (Pakistan)" },
  { code: "+880", iso: "BD", flag: "🇧🇩", name: "บังกลาเทศ (Bangladesh)" },
  { code: "+94", iso: "LK", flag: "🇱🇰", name: "ศรีลังกา (Sri Lanka)" },
  { code: "+977", iso: "NP", flag: "🇳🇵", name: "เนปาล (Nepal)" },
  { code: "+975", iso: "BT", flag: "🇧🇹", name: "ภูฏาน (Bhutan)" },
  { code: "+960", iso: "MV", flag: "🇲🇻", name: "มัลดีฟส์ (Maldives)" },
  { code: "+976", iso: "MN", flag: "🇲🇳", name: "มองโกเลีย (Mongolia)" },
  { code: "+998", iso: "UZ", flag: "🇺🇿", name: "อุซเบกิสถาน (Uzbekistan)" },
  { code: "+20", iso: "EG", flag: "🇪🇬", name: "อียิปต์ (Egypt)" },
  { code: "+27", iso: "ZA", flag: "🇿🇦", name: "แอฟริกาใต้ (South Africa)" },
  { code: "+234", iso: "NG", flag: "🇳🇬", name: "ไนจีเรีย (Nigeria)" },
  { code: "+254", iso: "KE", flag: "🇰🇪", name: "เคนยา (Kenya)" },
  { code: "+212", iso: "MA", flag: "🇲🇦", name: "โมร็อกโก (Morocco)" },
  { code: "+55", iso: "BR", flag: "🇧🇷", name: "บราซิล (Brazil)" },
  { code: "+54", iso: "AR", flag: "🇦🇷", name: "อาร์เจนตินา (Argentina)" },
  { code: "+52", iso: "MX", flag: "🇲🇽", name: "เม็กซิโก (Mexico)" },
  { code: "+56", iso: "CL", flag: "🇨🇱", name: "ชิลี (Chile)" },
  { code: "+57", iso: "CO", flag: "🇨🇴", name: "โคลอมเบีย (Colombia)" },
  { code: "+51", iso: "PE", flag: "🇵🇪", name: "เปรู (Peru)" },
  { code: "+58", iso: "VE", flag: "🇻🇪", name: "เวเนซุเอลา (Venezuela)" },
  { code: "+593", iso: "EC", flag: "🇪🇨", name: "เอกวาดอร์ (Ecuador)" },
  { code: "+598", iso: "UY", flag: "🇺🇾", name: "อุรุกวัย (Uruguay)" },
  { code: "+595", iso: "PY", flag: "🇵🇾", name: "ปารากวัย (Paraguay)" },
  { code: "+591", iso: "BO", flag: "🇧🇴", name: "โบลิเวีย (Bolivia)" },
  { code: "+507", iso: "PA", flag: "🇵🇦", name: "ปานามา (Panama)" },
  { code: "+506", iso: "CR", flag: "🇨🇷", name: "คอสตาริกา (Costa Rica)" },
  { code: "+53", iso: "CU", flag: "🇨🇺", name: "คิวบา (Cuba)" },
  { code: "+354", iso: "IS", flag: "🇮🇸", name: "ไอซ์แลนด์ (Iceland)" },
  { code: "+352", iso: "LU", flag: "🇱🇺", name: "ลักเซมเบิร์ก (Luxembourg)" },
  { code: "+377", iso: "MC", flag: "🇲🇨", name: "โมนาโก (Monaco)" },
  { code: "+40", iso: "RO", flag: "🇷🇴", name: "โรมาเนีย (Romania)" },
  { code: "+359", iso: "BG", flag: "🇧🇬", name: "บัลแกเรีย (Bulgaria)" },
  { code: "+381", iso: "RS", flag: "🇷🇸", name: "เซอร์เบีย (Serbia)" },
  { code: "+385", iso: "HR", flag: "🇭🇷", name: "โครเอเชีย (Croatia)" },
  { code: "+386", iso: "SI", flag: "🇸🇮", name: "สโลวีเนีย (Slovenia)" },
  { code: "+421", iso: "SK", flag: "🇸🇰", name: "สโลวาเกีย (Slovakia)" },
  { code: "+370", iso: "LT", flag: "🇱🇹", name: "ลิทัวเนีย (Lithuania)" },
  { code: "+371", iso: "LV", flag: "🇱🇻", name: "ลัตเวีย (Latvia)" },
  { code: "+372", iso: "EE", flag: "🇪🇪", name: "เอสโตเนีย (Estonia)" },
  { code: "+93", iso: "AF", flag: "🇦🇫", name: "อัฟกานิสถาน (Afghanistan)" },
  { code: "+355", iso: "AL", flag: "🇦🇱", name: "แอลเบเนีย (Albania)" },
  { code: "+213", iso: "DZ", flag: "🇩🇿", name: "แอลจีเรีย (Algeria)" },
  { code: "+376", iso: "AD", flag: "🇦🇩", name: "อันดอร์รา (Andorra)" },
  { code: "+244", iso: "AO", flag: "🇦🇴", name: "แองโกลา (Angola)" },
  { code: "+374", iso: "AM", flag: "🇦🇲", name: "อาร์เมเนีย (Armenia)" },
  { code: "+994", iso: "AZ", flag: "🇦🇿", name: "อาเซอร์ไบจาน (Azerbaijan)" },
  { code: "+375", iso: "BY", flag: "🇧🇾", name: "เบลารุส (Belarus)" },
  { code: "+387", iso: "BA", flag: "🇧🇦", name: "บอสเนียและเฮอร์เซโกวีนา" },
  { code: "+267", iso: "BW", flag: "🇧🇼", name: "บอตสวานา (Botswana)" },
  { code: "+237", iso: "CM", flag: "🇨🇲", name: "แคเมอรูน (Cameroon)" },
  { code: "+357", iso: "CY", flag: "🇨🇾", name: "ไซปรัส (Cyprus)" },
  { code: "+251", iso: "ET", flag: "🇪🇹", name: "เอธิโอเปีย (Ethiopia)" },
  { code: "+679", iso: "FJ", flag: "🇫🇯", name: "ฟิจิ (Fiji)" },
  { code: "+995", iso: "GE", flag: "🇬🇪", name: "จอร์เจีย (Georgia)" },
  { code: "+233", iso: "GH", flag: "🇬🇭", name: "กานา (Ghana)" },
  { code: "+964", iso: "IQ", flag: "🇮🇶", name: "อิรัก (Iraq)" },
  { code: "+996", iso: "KG", flag: "🇰🇬", name: "คีร์กีซสถาน (Kyrgyzstan)" },
  { code: "+961", iso: "LB", flag: "🇱🇧", name: "เลบานอน (Lebanon)" },
  { code: "+218", iso: "LY", flag: "🇱🇾", name: "ลิเบีย (Libya)" },
  { code: "+261", iso: "MG", flag: "🇲🇬", name: "มาดากัสการ์ (Madagascar)" },
  { code: "+356", iso: "MT", flag: "🇲🇹", name: "มอลตา (Malta)" },
  { code: "+230", iso: "MU", flag: "🇲🇺", name: "มอริเชียส (Mauritius)" },
  { code: "+373", iso: "MD", flag: "🇲🇩", name: "มอลโดวา (Moldova)" },
  { code: "+382", iso: "ME", flag: "🇲🇪", name: "มอนเตเนโกร (Montenegro)" },
  { code: "+258", iso: "MZ", flag: "🇲🇿", name: "โมซัมบิก (Mozambique)" },
  { code: "+264", iso: "NA", flag: "🇳🇦", name: "นามิเบีย (Namibia)" },
  { code: "+675", iso: "PG", flag: "🇵🇬", name: "ปาปัวนิวกินี (Papua New Guinea)" },
  { code: "+221", iso: "SN", flag: "🇸🇳", name: "เซเนกัล (Senegal)" },
  { code: "+248", iso: "SC", flag: "🇸🇨", name: "เซเชลส์ (Seychelles)" },
  { code: "+249", iso: "SD", flag: "🇸🇩", name: "ซูดาน (Sudan)" },
  { code: "+963", iso: "SY", flag: "🇸🇾", name: "ซีเรีย (Syria)" },
  { code: "+992", iso: "TJ", flag: "🇹🇯", name: "ทาจิกิสถาน (Tajikistan)" },
  { code: "+255", iso: "TZ", flag: "🇹🇿", name: "แทนซาเนีย (Tanzania)" },
  { code: "+216", iso: "TN", flag: "🇹🇳", name: "ตูนิเซีย (Tunisia)" },
  { code: "+993", iso: "TM", flag: "🇹🇲", name: "เติร์กเมนิสถาน (Turkmenistan)" },
  { code: "+256", iso: "UG", flag: "🇺🇬", name: "ยูกันดา (Uganda)" },
  { code: "+967", iso: "YE", flag: "🇾🇪", name: "เยเมน (Yemen)" },
  { code: "+260", iso: "ZM", flag: "🇿🇲", name: "แซมเบีย (Zambia)" },
  { code: "+263", iso: "ZW", flag: "🇿🇼", name: "ซิมบับเว (Zimbabwe)" }
];

function populateItuDialCodeSelect() {
  const selectEl = document.getElementById("addrPhoneDialCode");
  if (!selectEl || selectEl.options.length > 5) return;
  selectEl.innerHTML = ITU_COUNTRY_CALLING_CODES.map(
    c => `<option value="${c.code}" data-iso="${c.iso}">${c.code} ${c.flag} — ${c.name}</option>`
  ).join("");
}

function splitSavedPhoneWithDialCode(rawPhone) {
  const cleaned = (rawPhone || "").trim();
  if (!cleaned) return { dialCode: "+66", localNumber: "" };

  // เรียงรหัสที่ยาวที่สุดก่อนเพื่อจับคู่ได้แม่นยำ (เช่น +856 ก่อน +8)
  const sortedCodes = [...ITU_COUNTRY_CALLING_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const item of sortedCodes) {
    if (cleaned.startsWith(item.code)) {
      return {
        dialCode: item.code,
        localNumber: cleaned.slice(item.code.length).trim()
      };
    }
  }
  return { dialCode: "+66", localNumber: cleaned };
}

async function openProfileModal() {
  if (!requireLoginFirst()) return;
  populateItuDialCodeSelect();

  try {
    const res = await fetch(`/api/profile/full?email=${encodeURIComponent(currentUser.email)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.user) {
        currentUser = { ...currentUser, ...data.user };
        saveUserSession();
      }
    }
  } catch (e) {}

  document.getElementById("profAvatarPreview").src =
    currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`;
  document.getElementById("profHeaderName").textContent = currentUser.username;
  document.getElementById("profHeaderEmail").textContent = currentUser.email;

  document.getElementById("profUsername").value = currentUser.username || "";
  document.getElementById("profPhone").value = currentUser.phone || "";
  document.getElementById("profEmail").value = currentUser.email || "";
  document.getElementById("profPassword").value = currentUser.password || "";

  document.getElementById("addrRecipientName").value = currentUser.recipient_name || currentUser.username || "";

  const parsedPhone = splitSavedPhoneWithDialCode(currentUser.recipient_phone || currentUser.phone || "");
  const dialSelect = document.getElementById("addrPhoneDialCode");
  if (dialSelect) dialSelect.value = parsedPhone.dialCode;
  document.getElementById("addrRecipientPhone").value = parsedPhone.localNumber;

  document.getElementById("addrCountryScope").value = currentUser.country_type || "ในประเทศ";

  // ป้องกันกรณีเคยมีข้อความพิกัดละติจูดค้างอยู่จากรอบก่อน
  const savedRegion = currentUser.region_text || "";
  document.getElementById("addrRegionText").value = savedRegion.startsWith("พิกัดปัจจุบัน") ? "" : savedRegion;
  document.getElementById("addrDetailText").value = currentUser.detail_address || "";

  pinnedLat = Number(currentUser.lat || FARM_ORIGIN_LAT);
  pinnedLng = Number(currentUser.lng || FARM_ORIGIN_LNG);
  pinnedDistanceKm = Number(currentUser.distance_km || 0);
  document.getElementById("addrDistanceKm").value = `${pinnedDistanceKm.toLocaleString("th-TH")} กม.`;

  switchProfileSubView("menu");
  openModal("profileModal");
}

function switchProfileSubView(viewName) {
  const views = {
    menu: document.getElementById("profViewMenu"),
    security: document.getElementById("profViewSecurity"),
    address: document.getElementById("profViewAddress"),
    policy: document.getElementById("profViewPolicy"),
    help: document.getElementById("profViewHelp")
  };

  Object.keys(views).forEach(k => {
    if (views[k]) {
      if (k === viewName) views[k].classList.remove("hidden");
      else views[k].classList.add("hidden");
    }
  });

  if (viewName === "address") {
    populateItuDialCodeSelect();
    setTimeout(initOrRefreshAddressMap, 120);
  }
}

function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1.25);
}

function initOrRefreshAddressMap() {
  const mapBox = document.getElementById("userAddressMap");
  if (!mapBox || typeof L === "undefined") return;

  if (!leafletMap) {
    leafletMap = L.map("userAddressMap").setView([pinnedLat, pinnedLng], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap"
    }).addTo(leafletMap);

    leafletMarker = L.marker([pinnedLat, pinnedLng], { draggable: true }).addTo(leafletMap);

    leafletMap.on("click", e => {
      updateMapPinPosition(e.latlng.lat, e.latlng.lng, true);
    });

    leafletMarker.on("dragend", e => {
      const pos = e.target.getLatLng();
      updateMapPinPosition(pos.lat, pos.lng, true);
    });
  } else {
    leafletMap.invalidateSize();
    leafletMap.setView([pinnedLat, pinnedLng], 6);
    leafletMarker.setLatLng([pinnedLat, pinnedLng]);
  }
}

// แปลงพิกัดหมุดเป็นชื่อสถานที่จริง (จังหวัด, เขต/อำเภอ, แขวง/ตำบล หรือชื่อประเทศ) และเปลี่ยนในประเทศ/ต่างประเทศอัตโนมัติ
async function reverseGeocodePinToPlaceName(lat, lng) {
  const regionInput = document.getElementById("addrRegionText");
  const scopeInput = document.getElementById("addrCountryScope");
  const dialSelect = document.getElementById("addrPhoneDialCode");

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1`,
      { headers: { "Accept-Language": "th,en" } }
    );
    if (!res.ok) throw new Error("Geocoding failed");
    const data = await res.json();
    const addr = data.address || {};
    const countryCode = (addr.country_code || "").toUpperCase();

    // 1. ตรวจสอบว่าเป็นประเทศไทย (TH) หรือต่างประเทศ แล้วล็อกค่าในช่อง "ในประเทศไทย/ต่างประเทศ"
    const isThailand = countryCode === "TH";
    if (scopeInput) {
      scopeInput.value = isThailand ? "ในประเทศ" : "ต่างประเทศ";
    }

    // 2. ปรับรหัสโทรศัพท์ระหว่างประเทศ (ITU) ให้ตรงกับประเทศที่ปักหมุดอัตโนมัติ
    if (countryCode && dialSelect) {
      const matchedCountry = ITU_COUNTRY_CALLING_CODES.find(c => c.iso === countryCode);
      if (matchedCountry) {
        dialSelect.value = matchedCountry.code;
      }
    }

    // 3. สร้างข้อความชื่อสถานที่ (จังหวัด, เขต/อำเภอ, แขวง/ตำบล) ไม่แสดงเป็นละติจูด/ลองจิจูด
    let parts = [];
    if (isThailand) {
      const province = addr.province || addr.state || addr.city || "";
      const district = addr.county || addr.city_district || addr.district || addr.municipality || "";
      const subdistrict = addr.suburb || addr.tambon || addr.village || addr.town || addr.Quarter || "";
      parts = [province, district, subdistrict].filter(Boolean);
    } else {
      const country = addr.country || "";
      const stateOrCity = addr.state || addr.province || addr.city || addr.town || "";
      const districtOrSuburb = addr.county || addr.suburb || addr.village || "";
      parts = [country, stateOrCity, districtOrSuburb].filter(Boolean);
    }

    if (regionInput) {
      if (parts.length > 0) {
        regionInput.value = parts.join(", ");
      } else if (data.display_name) {
        regionInput.value = data.display_name.split(",").slice(0, 3).map(s => s.trim()).join(", ");
      }
    }
  } catch (err) {
    // กรณีอินเทอร์เน็ตบล็อก Nominatim ให้เช็กขอบเขตประเทศไทยเบื้องต้น
    const isInsideThailand = lat >= 5.6 && lat <= 20.5 && lng >= 97.3 && lng <= 105.6;
    if (scopeInput) {
      scopeInput.value = isInsideThailand ? "ในประเทศ" : "ต่างประเทศ";
    }
  }
}

function updateMapPinPosition(lat, lng, shouldLookupPlace = true) {
  pinnedLat = lat;
  pinnedLng = lng;
  if (leafletMarker) leafletMarker.setLatLng([lat, lng]);

  const originLat = typeof dynamicFarmSettings !== "undefined" ? dynamicFarmSettings.farm_lat : FARM_ORIGIN_LAT;
  const originLng = typeof dynamicFarmSettings !== "undefined" ? dynamicFarmSettings.farm_lng : FARM_ORIGIN_LNG;
  pinnedDistanceKm = calculateHaversineKm(originLat, originLng, lat, lng);
  document.getElementById("addrDistanceKm").value = `${pinnedDistanceKm.toLocaleString("th-TH")} กม.`;

  // เช็กเบื้องต้นทันทีก่อนที่ API ชื่อสถานที่จะตอบกลับ
  const isInsideThailand = lat >= 5.6 && lat <= 20.5 && lng >= 97.3 && lng <= 105.6;
  document.getElementById("addrCountryScope").value = isInsideThailand ? "ในประเทศ" : "ต่างประเทศ";

  if (shouldLookupPlace) {
    reverseGeocodePinToPlaceName(lat, lng);
  }
}

function useCurrentLocationForAddress() {
  if (!navigator.geolocation) {
    showToast("เบราว์เซอร์ของคุณไม่รองรับการดึงพิกัดปัจจุบัน");
    return;
  }
  showToast("กำลังค้นหาตำแหน่งที่อยู่ปัจจุบันของคุณ...");
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      updateMapPinPosition(lat, lng, false);
      if (leafletMap) leafletMap.setView([lat, lng], 13);
      await reverseGeocodePinToPlaceName(lat, lng);
      showToast(`ดึงตำแหน่งจัดส่งสำเร็จ! (ระยะทาง ${pinnedDistanceKm} กม.)`);
    },
    () => {
      showToast("ไม่สามารถเข้าถึง GPS ได้ กรุณาคลิกปักหมุดบนแผนที่โดยตรง");
    }
  );
}

async function submitProfileHelpRequest(event) {
  event.preventDefault();
  if (!currentUser) return;
  const reason = document.getElementById("profHelpReason").value;
  const details = document.getElementById("profHelpDetails").value.trim();

  try {
    await fetch("/api/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: currentUser.email,
        reason,
        details
      })
    });
    document.getElementById("profHelpDetails").value = "";
    switchProfileSubView("menu");
    showToast("ส่งเรื่องขอความช่วยเหลือไปยังแอดมินเรียบร้อยแล้ว");
  } catch (e) {
    showToast("ไม่สามารถส่งคำร้องได้");
  }
}

async function handleUserAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const base64 = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });

  try {
    const res = await fetch("/api/profile/avatar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: currentUser.email, avatar: base64 })
    });
    const data = await res.json();
    if (data.ok && data.user) {
      currentUser = { ...currentUser, ...data.user };
      saveUserSession();
      updateAuthUI();
      document.getElementById("profAvatarPreview").src = currentUser.avatar;
      showToast("อัปเดตรูปโปรไฟล์เรียบร้อย");
    }
  } catch (e) {}
}

async function saveProfileSecurity(event) {
  event.preventDefault();
  const username = document.getElementById("profUsername").value.trim();
  const phone = document.getElementById("profPhone").value.trim();
  const email = document.getElementById("profEmail").value.trim();
  const password = document.getElementById("profPassword").value;

  try {
    const res = await fetch("/api/profile/security", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldEmail: currentUser.email,
        username,
        phone,
        email,
        password,
        currentPassword: currentUser.password
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.message || "ไม่สามารถบันทึกข้อมูลได้");
      return;
    }
    currentUser = { ...currentUser, ...data.user };
    saveUserSession();
    updateAuthUI();
    showToast("บันทึกข้อมูลบัญชีเรียบร้อยแล้ว");
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
  }
}

async function saveProfileAddress(event) {
  event.preventDefault();
  const recipientName = document.getElementById("addrRecipientName").value.trim();
  const dialCode = document.getElementById("addrPhoneDialCode")?.value || "+66";
  const rawPhone = document.getElementById("addrRecipientPhone").value.trim();
  const recipientPhone = `${dialCode} ${rawPhone}`.trim();
  const countryType = document.getElementById("addrCountryScope").value;
  const regionText = document.getElementById("addrRegionText").value.trim();
  const detailAddress = document.getElementById("addrDetailText").value.trim();

  try {
    const res = await fetch("/api/profile/address", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: currentUser.email,
        recipientName,
        recipientPhone,
        countryType,
        regionText,
        detailAddress,
        lat: pinnedLat,
        lng: pinnedLng,
        distanceKm: pinnedDistanceKm
      })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      currentUser = { ...currentUser, ...data.user };
      saveUserSession();
      showToast(`บันทึกที่อยู่ (${countryType} • ระยะทาง ${pinnedDistanceKm} กม.) เรียบร้อยแล้ว`);
    }
  } catch (e) {
    showToast("ไม่สามารถบันทึกที่อยู่ได้");
  }
}

// ============================================================================
// 8. กระดิ่งแจ้งเตือนสถานะคำสั่งซื้อ และประวัติการสั่งซื้อ + ให้ดาวเขียนรีวิว
// ============================================================================
async function refreshUnreadNotificationBadge() {
  if (!currentUser) return;
  try {
    const res = await fetch(`/api/notifications?email=${encodeURIComponent(currentUser.email)}`);
    const data = await res.json();
    const badge = document.getElementById("notifCountBadge");
    if (!badge) return;
    const unread = Number(data.unreadCount || 0);
    badge.textContent = String(unread);
    if (unread > 0) {
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (e) {}
}

async function openNotificationsModal() {
  if (!requireLoginFirst()) return;
  const container = document.getElementById("notificationsListContainer");
  openModal("notificationsModal");

  try {
    const res = await fetch(`/api/notifications?email=${encodeURIComponent(currentUser.email)}`);
    const data = await res.json();
    const list = data.notifications || [];

    if (list.length === 0) {
      container.innerHTML = `<p class="text-center text-sm text-gray-400 py-8">ยังไม่มีการแจ้งเตือน</p>`;
    } else {
      container.innerHTML = list
        .map(
          n => `
          <div class="bg-black/50 border border-white/10 rounded-2xl p-3.5 flex items-start justify-between gap-3">
            <div>
              <h4 class="font-bold text-sm text-hbGold">${n.title}</h4>
              <p class="text-xs text-gray-200 mt-1">${n.message}</p>
              <p class="text-[10px] text-gray-500 mt-1">${n.created_at}</p>
            </div>
            <button onclick="deleteUserNotif(${n.notif_id})" class="text-xs text-red-400 hover:text-red-300">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        `
        )
        .join("");
    }

    await fetch("/api/notifications/read", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: currentUser.email })
    });
    await refreshUnreadNotificationBadge();
  } catch (e) {}
}

async function deleteUserNotif(notifId) {
  try {
    await fetch(`/api/notifications/${notifId}`, { method: "DELETE" });
    await openNotificationsModal();
  } catch (e) {}
}

async function openOrdersHistoryModal() {
  if (!requireLoginFirst()) return;
  const container = document.getElementById("ordersHistoryListContainer");
  openModal("ordersHistoryModal");

  try {
    const res = await fetch(`/api/orders?email=${encodeURIComponent(currentUser.email)}`);
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      container.innerHTML = `<p class="text-center text-sm text-gray-400 py-10">คุณยังไม่มีประวัติคำสั่งซื้อ</p>`;
      return;
    }

    const statusMap = {
      pending_approval: "รอแอดมินตรวจสอบและอนุมัติ",
      preparing: "กำลังเตรียมม้า/สินค้าและตรวจสุขภาพ",
      shipping: "อยู่ระหว่างกำลังขนส่ง",
      delivered: "จัดส่งสำเร็จเรียบร้อย",
      rejected: "คำสั่งซื้อถูกยกเลิก/ปฏิเสธ"
    };

    container.innerHTML = orders
      .map(
        o => `
        <div class="bg-black/50 border border-white/15 rounded-2xl p-4 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div>
              <span class="font-extrabold text-sm text-hbOrange">${o.orderNumber}</span>
              <span class="text-xs text-gray-400 ml-2">${o.createdAt}</span>
            </div>
            <span class="px-3 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold">
              ${statusMap[o.status] || o.status}
            </span>
          </div>
          <div class="text-xs text-gray-300 space-y-2">
            ${o.items
              .map(
                i => `
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span>• ${i.title} (x${i.qty}) — ${formatTHB(i.price * i.qty)}</span>
                  ${
                    o.status === "delivered" && !i.isReviewed
                      ? `<button onclick="promptCustomerReview(${i.itemId}, '${i.type}', '${i.refId}', '${i.title.replace(/'/g, "")}')" class="px-3 py-1 rounded-full bg-hbGold hover:bg-amber-400 text-black font-extrabold text-[11px] transition">★ เขียนรีวิวสินค้า</button>`
                      : i.isReviewed
                      ? `<span class="text-emerald-400 font-bold text-[11px]">✓ รีวิวแล้ว</span>`
                      : ""
                  }
                </div>
              `
              )
              .join("")}
          </div>
          <div class="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
            <span class="text-gray-400 truncate max-w-xs">จัดส่งที่: ${o.shippingAddress}</span>
            <span class="font-extrabold text-sm text-emerald-400">ยอดสุทธิ: ${formatTHB(o.grandTotal)}</span>
          </div>
        </div>
      `
      )
      .join("");
  } catch (e) {}
}

async function promptCustomerReview(orderItemId, itemType, refId, itemTitle) {
  const starsStr = prompt(`ให้คะแนนความพึงพอใจสำหรับ "${itemTitle}" (พิมพ์ตัวเลข 1 ถึง 5 ดาว):`, "5");
  if (!starsStr) return;
  const stars = Math.min(5, Math.max(1, parseInt(starsStr, 10) || 5));
  const comment = prompt(`เขียนความคิดเห็นรีวิวสำหรับ "${itemTitle}":`, "ม้าและสินค้าคุณภาพดีมาก จัดส่งปลอดภัยครับ");
  if (comment === null) return;

  try {
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderItemId,
        itemType,
        refId,
        reviewerName: currentUser?.username || "ผู้ใช้งาน",
        stars,
        comment: comment.trim() || "สินค้าคุณภาพดีมาก",
        date: new Date().toLocaleDateString("th-TH")
      })
    });
    if (res.ok) {
      await loadInitialData();
      await openOrdersHistoryModal();
      showToast("บันทึกรีวิวของคุณเรียบร้อยแล้ว ขอบคุณครับ!");
    }
  } catch (e) {}
}
// ============================================================================
// เชื่อมการตั้งค่าพิกัดฟาร์มและเรทค่าขนส่งจากหน้าแอดมิน (เมนูตั้งค่าระบบฟาร์ม)
// ============================================================================
let dynamicFarmSettings = {
  farm_name: "ขอนแก่น (สาขาหลัก)",
  farm_lat: 16.4419,
  farm_lng: 102.8360,
  land_base: 3500,
  land_per_km: 30,
  land_stall_shared: 2500,
  land_stall_single: 4500,
  land_stall_vip: 16000,
  air_base: 150000,
  air_per_km: 50,
  air_stall_shared: 100000,
  air_stall_single: 350000,
  air_stall_vip: 777000,
  parcel_fee: 50
};

async function loadDynamicFarmSettings() {
  try {
    const res = await fetch(`/api/settings?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && data.settings) {
      const s = data.settings;
      dynamicFarmSettings = {
        farm_name: s.farm_name || "ขอนแก่น",
        farm_lat: parseFloat(s.farm_lat || 16.4419),
        farm_lng: parseFloat(s.farm_lng || 102.8360),
        land_base: parseFloat(s.land_base || 3500),
        land_per_km: parseFloat(s.land_per_km || 30),
        land_stall_shared: parseFloat(s.land_stall_shared || 2500),
        land_stall_single: parseFloat(s.land_stall_single || 4500),
        land_stall_vip: parseFloat(s.land_stall_vip || 16000),
        air_base: parseFloat(s.air_base || 150000),
        air_per_km: parseFloat(s.air_per_km || 50),
        air_stall_shared: parseFloat(s.air_stall_shared || 100000),
        air_stall_single: parseFloat(s.air_stall_single || 350000),
        air_stall_vip: parseFloat(s.air_stall_vip || 777000),
        parcel_fee: parseFloat(s.parcel_fee || 50)
      };
    }
  } catch (e) {}
}

window.addEventListener("DOMContentLoaded", loadDynamicFarmSettings);
window.addEventListener("storage", e => {
  if (e.key === "hb_catalog_realtime_sync") loadDynamicFarmSettings();
});

// อัปเดตการคำนวณระยะทางเมื่อปักหมุดให้ใช้พิกัดฟาร์มล่าสุดที่แอดมินตั้งไว้
updateMapPinPosition = function (lat, lng) {
  pinnedLat = lat;
  pinnedLng = lng;
  if (leafletMarker) leafletMarker.setLatLng([lat, lng]);
  pinnedDistanceKm = calculateHaversineKm(dynamicFarmSettings.farm_lat, dynamicFarmSettings.farm_lng, lat, lng);
  document.getElementById("addrDistanceKm").value = `${pinnedDistanceKm.toLocaleString("th-TH")} กม.`;

  const isInsideThailand = lat >= 5.5 && lat <= 20.6 && lng >= 97.3 && lng <= 105.7;
  document.getElementById("addrCountryScope").value = isInsideThailand ? "ในประเทศ" : "ต่างประเทศ";
};

// อัปเดตสูตรคำนวณค่าจัดส่งในหน้าชำระเงินให้ใช้เรทราคาจากหน้าตั้งค่าระบบฟาร์มของแอดมิน
getCheckoutTotals = function () {
  const subtotal = checkoutItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const userScope = document.getElementById("chkCountryScope")?.value || "ในประเทศ";
  const distanceKm = Number(currentUser?.distance_km || 0);
  const mode = document.getElementById("chkTransportMode")?.value || chkSelectedTransportMode;
  const stall = document.getElementById("chkStallType")?.value || chkSelectedStallType;
  const isHorseOrder = hasHorseInCheckoutItems();

  let shippingCost = 0;
  let travelExpense = 0;
  let docFee = 0;
  let insuranceFee = 0;

  if (!isHorseOrder) {
    shippingCost = dynamicFarmSettings.parcel_fee;
  } else {
    if (mode === "land") {
      const baseTruck = dynamicFarmSettings.land_base;
      const distCost = stall === "vip" ? 0 : distanceKm * dynamicFarmSettings.land_per_km;
      const stallCost =
        stall === "shared"
          ? dynamicFarmSettings.land_stall_shared
          : stall === "single"
          ? dynamicFarmSettings.land_stall_single
          : dynamicFarmSettings.land_stall_vip;
      shippingCost = baseTruck + distCost + stallCost;
    } else {
      const basePlane = dynamicFarmSettings.air_base;
      const distCost = stall === "vip" ? 0 : distanceKm * dynamicFarmSettings.air_per_km;
      const stallCost =
        stall === "shared"
          ? dynamicFarmSettings.air_stall_shared
          : stall === "single"
          ? dynamicFarmSettings.air_stall_single
          : dynamicFarmSettings.air_stall_vip;
      shippingCost = basePlane + distCost + stallCost;
    }

    travelExpense = 1600 + 1000 + 14000 + (userScope === "ต่างประเทศ" ? 300000 : 0);
    docFee = 7600 + 23600;
    insuranceFee = Math.round(subtotal * 0.015);
  }

  const totalBeforeVat = subtotal + shippingCost + travelExpense + docFee + insuranceFee;
  const vat = Math.round(totalBeforeVat * 0.07);
  const grandTotal = totalBeforeVat + vat;

  return {
    subtotal,
    shippingCost,
    travelExpense,
    docFee,
    insuranceFee,
    vat,
    grandTotal,
    userScope,
    distanceKm,
    mode,
    stall,
    isHorseOrder
  };
};
// ============================================================================
// ระบบกลิ้งลูกกลิ้งเมาส์ (Scroll Wheel) สลับดู "ทำไมถึงต้องม้า" <-> "ประวัติฟาร์มของเรา HB"
// ============================================================================
let currentHistorySlideIndex = 0;
let lastHistoryWheelTime = 0;

function switchHistorySlide(slideIdx) {
  currentHistorySlideIndex = slideIdx;
  const slide0 = document.getElementById("historySlide0");
  const slide1 = document.getElementById("historySlide1");
  const ind0 = document.getElementById("histIndicator0");
  const ind1 = document.getElementById("histIndicator1");

  if (!slide0 || !slide1) return;

  if (slideIdx === 0) {
    slide0.classList.remove("hidden");
    slide1.classList.add("hidden");
    if (ind0) ind0.className = "w-2.5 h-10 rounded-full bg-white shadow-lg transition-all duration-300";
    if (ind1) ind1.className = "w-2.5 h-4 rounded-full bg-white/30 hover:bg-white/60 transition-all duration-300";
  } else {
    slide0.classList.add("hidden");
    slide1.classList.remove("hidden");
    if (ind0) ind0.className = "w-2.5 h-4 rounded-full bg-white/30 hover:bg-white/60 transition-all duration-300";
    if (ind1) ind1.className = "w-2.5 h-10 rounded-full bg-white shadow-lg transition-all duration-300";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const historySection = document.getElementById("hbHistoryStorySection");
  if (!historySection) return;

  historySection.addEventListener(
    "wheel",
    e => {
      const now = Date.now();
      if (now - lastHistoryWheelTime < 400) {
        e.preventDefault();
        return;
      }

      // ถ้าอยู่สไลด์ที่ 1 (ทำไมถึงต้องม้า) แล้วกลิ้งเมาส์ลง -> สลับไปสไลด์ที่ 2 (ประวัติฟาร์มของเรา HB)
      if (e.deltaY > 0 && currentHistorySlideIndex === 0) {
        e.preventDefault();
        lastHistoryWheelTime = now;
        switchHistorySlide(1);
      }
      // ถ้าอยู่สไลด์ที่ 2 (ประวัติฟาร์มของเรา HB) แล้วกลิ้งเมาส์ขึ้น -> สลับกลับไปสไลด์ที่ 1 (ทำไมถึงต้องม้า)
      else if (e.deltaY < 0 && currentHistorySlideIndex === 1) {
        e.preventDefault();
        lastHistoryWheelTime = now;
        switchHistorySlide(0);
      }
    },
    { passive: false }
  );
});
// ============================================================================
// ปุ่มเลื่อนกลับขึ้นด้านบนสุดอย่างลื่นไหล (Smooth Scroll to Top)
// ============================================================================
let scrollAnimationId = null;

function scrollToTopSmoothly() {
  const startY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  if (startY <= 0) return;

  if (scrollAnimationId) {
    cancelAnimationFrame(scrollAnimationId);
  }

  const duration = 800; // ความเร็วในการเลื่อนขึ้น (800 มิลลิวินาที) หากอยากให้ช้าลงปรับเป็น 1000 ได้ครับ
  let startTime = null;

  // สูตรคำนวณความสมูท (Ease-In-Out Cubic: ออกตัวนุ่มและชะลออย่างลื่นไหลตอนถึงด้านบน)
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(currentTime) {
    if (!startTime) startTime = currentTime;
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(progress);
    const nextY = Math.round(startY * (1 - eased));

    window.scrollTo({ top: nextY, behavior: "instant" });
    document.documentElement.scrollTop = nextY;
    document.body.scrollTop = nextY;

    if (progress < 1) {
      scrollAnimationId = requestAnimationFrame(step);
    } else {
      scrollAnimationId = null;
    }
  }

  scrollAnimationId = requestAnimationFrame(step);
}

// หากผู้ใช้หมุนลูกกลิ้งเมาส์ระหว่างที่กำลังเลื่อนขึ้น ให้หยุดเลื่อนอัตโนมัติทันทีเพื่อไม่ให้ฝืนมือผู้ใช้
window.addEventListener(
  "wheel",
  () => {
    if (scrollAnimationId) {
      cancelAnimationFrame(scrollAnimationId);
      scrollAnimationId = null;
    }
  },
  { passive: true }
);

window.addEventListener("scroll", () => {
  const btn = document.getElementById("scrollToTopBtn");
  if (!btn) return;
  if (window.scrollY > 320) {
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
});
// ============================================================================
// 9. ระบบสไลด์การ์ดสินค้า ปุ่มลูกศร < > และจุดบอกหน้า (หน้าละ 4 การ์ด) + เมนู 3 ขีด
// ============================================================================
const catalogPageState = {
  racing: 0,
  show: 0,
  feed: 0,
  equipment: 0
};
const ITEMS_PER_SLIDE_PAGE = 4;
let lastCatalogSearchKeyword = "";

function toggleQuickCategoryDrawer() {
  const drawer = document.getElementById("quickCategoryDrawer");
  if (drawer) drawer.classList.toggle("hidden");
}

function renderCatalogSectionWithPagination(catKey, fullList, gridId, dotsId, isHorse) {
  const gridEl = document.getElementById(gridId);
  const dotsEl = document.getElementById(dotsId);
  if (!gridEl) return;

  if (!fullList || fullList.length === 0) {
    gridEl.innerHTML = `<p class="col-span-full text-sm text-gray-400 py-4">ไม่พบรายการสินค้าในหมวดนี้</p>`;
    if (dotsEl) dotsEl.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(fullList.length / ITEMS_PER_SLIDE_PAGE));
  if (catalogPageState[catKey] >= totalPages) {
    catalogPageState[catKey] = 0;
  }
  const currentPage = catalogPageState[catKey];
  const startIdx = currentPage * ITEMS_PER_SLIDE_PAGE;
  const pageItems = fullList.slice(startIdx, startIdx + ITEMS_PER_SLIDE_PAGE);

  gridEl.innerHTML = pageItems
    .map(item => (isHorse ? createHorseCardHTML(item) : createOtherProductCardHTML(item)))
    .join("");

  if (dotsEl) {
    dotsEl.innerHTML = Array.from({ length: totalPages })
      .map(
        (_, idx) => `
        <button
          type="button"
          onclick="goToCatalogPage('${catKey}', ${idx})"
          class="w-3 h-3 rounded-full transition-all duration-300 ${
            idx === currentPage ? "bg-white scale-125 shadow" : "bg-white/35 hover:bg-white/70"
          }"
          title="หน้าที่ ${idx + 1}"
        ></button>
      `
      )
      .join("");
  }
}

renderAllCatalogs = function (searchKeyword = lastCatalogSearchKeyword) {
  lastCatalogSearchKeyword = searchKeyword || "";
  const kw = lastCatalogSearchKeyword.trim().toLowerCase();

  const racingList = horsesData.filter(
    h => h.category === "racing" && (!kw || h.breed.toLowerCase().includes(kw) || (h.description || "").toLowerCase().includes(kw))
  );
  const showList = horsesData.filter(
    h => h.category === "show" && (!kw || h.breed.toLowerCase().includes(kw) || (h.description || "").toLowerCase().includes(kw))
  );
  const feedList = otherProductsData.filter(
    p => p.category === "feed" && (!kw || p.name.toLowerCase().includes(kw) || (p.description || "").toLowerCase().includes(kw))
  );
  const equipList = otherProductsData.filter(
    p => p.category === "equipment" && (!kw || p.name.toLowerCase().includes(kw) || (p.description || "").toLowerCase().includes(kw))
  );

  renderCatalogSectionWithPagination("racing", racingList, "racingHorseGrid", "racingDots", true);
  renderCatalogSectionWithPagination("show", showList, "showHorseGrid", "showDots", true);
  renderCatalogSectionWithPagination("feed", feedList, "feedProductGrid", "feedDots", false);
  renderCatalogSectionWithPagination("equipment", equipList, "equipmentProductGrid", "equipmentDots", false);
};

function changeCatalogPage(catKey, delta) {
  const kw = lastCatalogSearchKeyword.trim().toLowerCase();
  let list = [];
  if (catKey === "racing" || catKey === "show") {
    list = horsesData.filter(
      h => h.category === catKey && (!kw || h.breed.toLowerCase().includes(kw) || (h.description || "").toLowerCase().includes(kw))
    );
  } else {
    list = otherProductsData.filter(
      p => p.category === catKey && (!kw || p.name.toLowerCase().includes(kw) || (p.description || "").toLowerCase().includes(kw))
    );
  }

  const totalPages = Math.max(1, Math.ceil(list.length / ITEMS_PER_SLIDE_PAGE));
  catalogPageState[catKey] = (catalogPageState[catKey] + delta + totalPages) % totalPages;
  renderAllCatalogs(lastCatalogSearchKeyword);
}

function goToCatalogPage(catKey, pageIndex) {
  catalogPageState[catKey] = pageIndex;
  renderAllCatalogs(lastCatalogSearchKeyword);
}

// ============================================================================
// 10. ระบบยืนยันรหัส OTP 6 หลัก ตอนสมัครสมาชิกใหม่ (SIGN UP)
// ============================================================================
let pendingSignupPayload = null;
let generatedSignupOtpCode = "";

handleUserRegister = async function (event) {
  event.preventDefault();
  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmEl = document.getElementById("regConfirmPassword");
  const confirmPass = confirmEl ? confirmEl.value : password;
  const errEl = document.getElementById("regErrorMsg");

  if (password !== confirmPass) {
    errEl.textContent = "รหัสผ่าน (PASSWORD) และยืนยันรหัสผ่าน (CONFIRM) ไม่ตรงกัน";
    errEl.classList.remove("hidden");
    return;
  }

  errEl.classList.add("hidden");
  pendingSignupPayload = { username, email, phone, password };
  generatedSignupOtpCode = String(Math.floor(100000 + Math.random() * 900000));

  document.getElementById("signupOtpEmailTarget").textContent = email;
  document.getElementById("signupDemoOtpDisplay").textContent = generatedSignupOtpCode;
  document.getElementById("signupOtpInput").value = "";
  document.getElementById("signupOtpErrorMsg").classList.add("hidden");

  closeModal("authModal");
  openModal("userSignupOtpModal");
};

async function confirmUserSignupOtp(event) {
  event.preventDefault();
  const enteredOtp = document.getElementById("signupOtpInput").value.trim();
  const errEl = document.getElementById("signupOtpErrorMsg");

  if (enteredOtp !== generatedSignupOtpCode || !pendingSignupPayload) {
    errEl.textContent = "รหัส OTP 6 หลักไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingSignupPayload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      closeModal("userSignupOtpModal");
      openAuthModal("register");
      const regErr = document.getElementById("regErrorMsg");
      regErr.textContent = data.message || "ข้อมูลซ้ำในระบบ ไม่สามารถสมัครสมาชิกได้";
      regErr.classList.remove("hidden");
      return;
    }

    currentUser = data.user;
    cart = [];
    pendingSignupPayload = null;
    saveUserSession();
    updateAuthUI();
    updateCartBadgeUI();
    closeModal("userSignupOtpModal");
    showToast("ยืนยัน OTP และสร้างบัญชีผู้ใช้งานสำเร็จ!");
  } catch (e) {
    errEl.textContent = "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์";
    errEl.classList.remove("hidden");
  }
}

// ============================================================================
// 11. หน้าต่างให้คะแนนดาว (1–5 ดาว ★) และเขียนรีวิวสินค้า
// ============================================================================
let activeReviewTarget = {
  orderItemId: null,
  itemType: "other",
  refId: "",
  itemTitle: "",
  stars: 5
};

promptCustomerReview = function (orderItemId, itemType, refId, itemTitle) {
  activeReviewTarget = { orderItemId, itemType, refId, itemTitle, stars: 5 };
  document.getElementById("revModalItemTitle").textContent = itemTitle;
  document.getElementById("revModalCommentInput").value = "";
  selectReviewStars(5);
  openModal("reviewStarModal");
};

function selectReviewStars(starCount) {
  activeReviewTarget.stars = starCount;
  const labels = {
    1: "1 ดาว (ต้องปรับปรุง)",
    2: "2 ดาว (พอใช้)",
    3: "3 ดาว (ปานกลาง)",
    4: "4 ดาว (ดีมาก)",
    5: "5 ดาว (ประทับใจมาก)"
  };
  document.getElementById("revStarLabelText").textContent = labels[starCount] || "5 ดาว";

  for (let i = 1; i <= 5; i++) {
    const btn = document.getElementById(`revStarBtn${i}`);
    if (!btn) continue;
    if (i <= starCount) {
      btn.className = "text-hbGold hover:scale-110 transition";
    } else {
      btn.className = "text-gray-600 hover:scale-110 transition";
    }
  }
}

async function submitStarReviewModal(event) {
  event.preventDefault();
  const comment = document.getElementById("revModalCommentInput").value.trim();
  if (!comment) return;

  try {
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderItemId: activeReviewTarget.orderItemId,
        itemType: activeReviewTarget.itemType,
        refId: activeReviewTarget.refId,
        reviewerName: currentUser?.username || "ผู้ใช้งาน",
        stars: activeReviewTarget.stars,
        comment,
        date: new Date().toLocaleDateString("th-TH")
      })
    });
    if (res.ok) {
      closeModal("reviewStarModal");
      await loadInitialData();
      await openOrdersHistoryModal();
      showToast("บันทึกรีวิวของคุณเรียบร้อยแล้ว ขอบคุณครับ!");
    }
  } catch (e) {
    showToast("ไม่สามารถบันทึกรีวิวได้");
  }
}

// ============================================================================
// 12. ดาวน์โหลดใบเสร็จรับเงินเป็นไฟล์รูปภาพ (.png) ลงเครื่องทันที
// ============================================================================
downloadReceiptImage = async function () {
  const receiptArea = document.getElementById("receiptPrintableArea");
  if (!receiptArea || typeof html2canvas === "undefined") {
    window.print();
    return;
  }
  try {
    showToast("กำลังสร้างไฟล์รูปภาพใบเสร็จ...");
    const canvas = await html2canvas(receiptArea, {
      backgroundColor: "#ffffff",
      scale: 2
    });
    const link = document.createElement("a");
    const orderNoText = (document.getElementById("rcpOrderNo")?.textContent || "HB-Receipt").replace(/[^a-zA-Z0-9-_]/g, "");
    link.download = `${orderNoText || "HORSE_BUDDY_Receipt"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("บันทึกไฟล์รูปภาพใบเสร็จลงเครื่องเรียบร้อยแล้ว!");
  } catch (e) {
    window.print();
  }
};
// ============================================================================
// 13. อัปเดตการบันทึกคำสั่งซื้อ + หน้าประวัติคำสั่งซื้อ + ปุ่มขอยกเลิกและคืนเงิน (ก่อนสถานะกำลังขนส่ง)
// ============================================================================
let targetCancelOrderId = null;
let targetCancelOrderNo = "";

submitFinalOrder = async function (event) {
  event.preventDefault();
  const calc = getCheckoutTotals();
  const address = document.getElementById("chkEditableAddress").value.trim();

  const slipFile = document.getElementById("paymentSlipFile").files[0];
  let slipBase64 = "slip_uploaded.jpg";
  if (slipFile) {
    slipBase64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(slipFile);
    });
  }

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userEmail: currentUser?.email || "",
        username: currentUser?.username || "",
        phone: currentUser?.phone || "",
        paymentMethod: selectedPaymentMethod,
        installmentMonths: 0,
        subtotal: calc.subtotal,
        vat: calc.vat,
        grandTotal: calc.grandTotal,
        paidNow: calc.grandTotal,
        monthlyInstallment: 0,
        slipImage: slipBase64,
        shippingAddress: address,
        shippingScope: calc.userScope,
        transportMode: calc.mode,
        stallType: calc.stall,
        distanceKm: calc.distanceKm,
        shippingCost: calc.shippingCost,
        travelExpense: calc.travelExpense,
        docFee: calc.docFee,
        insuranceFee: calc.insuranceFee,
        items: checkoutItems
      })
    });

    const result = await res.json();
    if (!res.ok || !result.ok) {
      showToast(result.message || "ไม่สามารถบันทึกคำสั่งซื้อได้");
      return;
    }

    const orderNo = result.orderNumber;
    const boughtSet = new Set(checkoutItems.map(i => i.cartId));
    cart = cart.filter(i => !boughtSet.has(i.cartId));
    saveUserSession();
    updateCartBadgeUI();

    localStorage.setItem("hb_order_realtime_sync", String(Date.now()));
    await loadInitialData();
    await refreshUnreadNotificationBadge();
    closeModal("checkoutModal");

    const methodLabel = selectedPaymentMethod === "qr" ? "QR PROMPTPAY" : "โมบายแบงก์กิ้ง";
    showReceiptModalWithDownload({
      orderNo,
      username: currentUser.username,
      phone: currentUser.phone,
      methodLabel,
      address,
      statusLabel: "รอแอดมินอนุมัติคำสั่งซื้อ",
      items: checkoutItems,
      subtotal: calc.subtotal,
      shippingCost: calc.shippingCost,
      travelExpense: calc.travelExpense,
      docFee: calc.docFee,
      insuranceFee: calc.insuranceFee,
      vat: calc.vat,
      grandTotal: calc.grandTotal,
      createdAt: new Date().toLocaleString("th-TH")
    });

    showToast(`บันทึกคำสั่งซื้อ ${orderNo} เรียบร้อยแล้ว!`);
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการบันทึกคำสั่งซื้อ");
  }
};

openOrdersHistoryModal = async function () {
  if (!requireLoginFirst()) return;
  const container = document.getElementById("ordersHistoryListContainer");
  openModal("ordersHistoryModal");

  try {
    const qEmail = encodeURIComponent(currentUser?.email || "");
    const qUser = encodeURIComponent(currentUser?.username || "");
    const res = await fetch(`/api/orders?email=${qEmail}&username=${qUser}&t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      container.innerHTML = `<p class="text-center text-sm text-gray-400 py-10">คุณยังไม่มีประวัติคำสั่งซื้อ</p>`;
      return;
    }

    const statusBadgeMap = {
      pending_approval: `<span class="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-extrabold">รอแอดมินตรวจสอบและอนุมัติ</span>`,
      preparing: `<span class="px-3 py-1 rounded-full bg-sky-500/20 text-sky-300 text-xs font-extrabold">กำลังเตรียมม้า/สินค้าและตรวจสุขภาพ</span>`,
      shipping: `<span class="px-3 py-1 rounded-full bg-orange-500/20 text-orange-300 text-xs font-extrabold">🚚 อยู่ระหว่างกำลังขนส่ง</span>`,
      delivered: `<span class="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-extrabold">✓ จัดส่งสำเร็จเรียบร้อย</span>`,
      cancel_requested: `<span class="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-extrabold">⏳ รอแอดมินตรวจสอบการยกเลิกและคืนเงิน</span>`,
      cancelled_refunded: `<span class="px-3 py-1 rounded-full bg-emerald-600/25 text-emerald-300 text-xs font-extrabold">💸 ยกเลิกและโอนเงินคืนสำเร็จแล้ว</span>`,
      rejected: `<span class="px-3 py-1 rounded-full bg-red-500/20 text-red-300 text-xs font-extrabold">✕ คำสั่งซื้อถูกยกเลิก/ปฏิเสธ</span>`
    };

    container.innerHTML = orders
      .map(o => {
        // เงื่อนไข: หากสถานะยังไม่ถึง "กำลังขนส่ง" (คือยังเป็น pending_approval หรือ preparing) สามารถกดขอยกเลิกและขอคืนเงินได้
        const canCancelAndRefund = o.status === "pending_approval" || o.status === "preparing";

        return `
          <div class="bg-black/60 border border-white/15 rounded-2xl p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <div>
                <span class="font-extrabold text-sm sm:text-base text-hbOrange">${o.orderNumber}</span>
                <span class="text-xs text-gray-400 ml-2">${o.createdAt}</span>
              </div>
              ${statusBadgeMap[o.status] || `<span class="text-xs text-gray-300">${o.status}</span>`}
            </div>

            <div class="text-xs text-gray-200 space-y-2">
              ${o.items
                .map(
                  i => `
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span>• ${i.title} (x${i.qty}) — ${formatTHB(i.price * i.qty)}</span>
                    ${
                      o.status === "delivered" && !i.isReviewed
                        ? `<button onclick="promptCustomerReview(${i.itemId}, '${i.type}', '${i.refId}', '${i.title.replace(/'/g, "")}')" class="px-3 py-1 rounded-full bg-hbGold hover:bg-amber-400 text-black font-extrabold text-[11px] transition">★ เขียนรีวิวสินค้า</button>`
                        : i.isReviewed
                        ? `<span class="text-emerald-400 font-bold text-[11px]">✓ รีวิวแล้ว</span>`
                        : ""
                    }
                  </div>
                `
                )
                .join("")}
            </div>

            ${
              o.status === "cancel_requested"
                ? `<div class="bg-purple-950/40 border border-purple-500/30 rounded-xl p-2.5 text-xs text-purple-200">
                     <p><strong>เหตุผลที่ขอยกเลิก:</strong> ${o.cancelReason || "-"}</p>
                     <p><strong>บัญชีรับเงินคืน:</strong> ${o.refundBankInfo || "-"}</p>
                   </div>`
                : ""
            }

            <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10 text-xs">
              <span class="text-gray-400 truncate max-w-xs">จัดส่งที่: ${o.shippingAddress}</span>
              <div class="flex items-center gap-3">
                <span class="font-extrabold text-sm text-emerald-400">ยอดสุทธิ: ${formatTHB(o.grandTotal)}</span>
                ${
                  canCancelAndRefund
                    ? `<button
                        type="button"
                        onclick="openCancelRefundModal(${o.orderId}, '${o.orderNumber}')"
                        class="px-3.5 py-1.5 rounded-full bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 font-extrabold text-xs transition"
                      >
                        ยกเลิกและขอคืนเงิน
                      </button>`
                    : o.status === "shipping"
                    ? `<span class="text-[11px] text-gray-500 font-semibold">(อยู่ระหว่างขนส่ง ไม่สามารถยกเลิกได้)</span>`
                    : ""
                }
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    console.warn("Error loading user orders:", e);
  }
};

function openCancelRefundModal(orderId, orderNumber) {
  targetCancelOrderId = orderId;
  targetCancelOrderNo = orderNumber;
  document.getElementById("cancelModalOrderNoText").textContent = `หมายเลขคำสั่งซื้อ: ${orderNumber}`;
  document.getElementById("cancelRefundBankInput").value = "";
  openModal("cancelRefundModal");
}

async function submitCancelRefundRequest(event) {
  event.preventDefault();
  if (!targetCancelOrderId) return;

  const reason = document.getElementById("cancelReasonSelect").value;
  const bankInfo = document.getElementById("cancelRefundBankInput").value.trim();

  try {
    const res = await fetch(`/api/orders/${targetCancelOrderId}/cancel-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, bankInfo })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.message || "ไม่สามารถส่งคำขอยกเลิกได้");
      return;
    }

    localStorage.setItem("hb_order_realtime_sync", String(Date.now()));
    closeModal("cancelRefundModal");
    await openOrdersHistoryModal();
    await refreshUnreadNotificationBadge();
    showToast(`ส่งคำขอยกเลิกและขอคืนเงินสำหรับ ${targetCancelOrderNo} เรียบร้อยแล้ว`);
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการส่งคำขอยกเลิก");
  }
}

// ซิงค์สถานะคำสั่งซื้อและการแจ้งเตือนแบบเรียลไทม์เมื่อแอดมินกดอนุมัติหรืออัปเดตที่หลังบ้าน
window.addEventListener("storage", e => {
  if (e.key === "hb_order_realtime_sync") {
    refreshUnreadNotificationBadge();
    const histModal = document.getElementById("ordersHistoryModal");
    if (histModal && !histModal.classList.contains("hidden")) {
      openOrdersHistoryModal();
    }
  }
});
// ============================================================================
// 14. ระบบรหัสผ่าน 8 ตัวขึ้นไป + ส่ง OTP เข้า Gmail จริง + ล็อกอินด้วย Google จริง
// ============================================================================
let otpVerifyContext = {
  mode: "", // 'signup' | 'google' | 'security'
  email: "",
  payload: null
};
let cachedGoogleClientId = "";
let googleTokenClient = null;

async function fetchGoogleClientIdConfig() {
  if (cachedGoogleClientId) return cachedGoogleClientId;
  try {
    const res = await fetch("/api/auth/config");
    const data = await res.json();
    if (data.ok && data.googleClientId) {
      cachedGoogleClientId = data.googleClientId;
    }
  } catch (e) {}
  return cachedGoogleClientId;
}

window.addEventListener("DOMContentLoaded", fetchGoogleClientIdConfig);

function toggleProfilePasswordVisibility() {
  const passInput = document.getElementById("profPassword");
  const eyeIcon = document.getElementById("profPassEyeIcon");
  if (!passInput) return;

  if (passInput.type === "password") {
    passInput.type = "text";
    if (eyeIcon) eyeIcon.className = "fa-solid fa-eye text-xs text-hbGold";
  } else {
    passInput.type = "password";
    if (eyeIcon) eyeIcon.className = "fa-solid fa-eye-slash text-xs";
  }
}

const _origOpenProfileModal = openProfileModal;
openProfileModal = async function () {
  await _origOpenProfileModal();
  const passInput = document.getElementById("profPassword");
  const eyeIcon = document.getElementById("profPassEyeIcon");
  if (passInput) passInput.type = "password";
  if (eyeIcon) eyeIcon.className = "fa-solid fa-eye-slash text-xs";
};

function openRealOtpModalUI(mode, targetEmail, payload) {
  otpVerifyContext = {
    mode,
    email: targetEmail,
    payload
  };

  const emailEl = document.getElementById("signupOtpEmailTarget");
  const inputEl = document.getElementById("signupOtpInput");
  const errEl = document.getElementById("signupOtpErrorMsg");

  if (emailEl) emailEl.textContent = targetEmail || "";
  if (inputEl) inputEl.value = "";
  if (errEl) errEl.classList.add("hidden");

  openModal("userSignupOtpModal");
}

// ปุ่มกดขอรหัส OTP ซ้ำอีกครั้งเข้า Gmail
async function resendRealEmailOtp() {
  if (!otpVerifyContext.email || !otpVerifyContext.payload) return;
  showToast("กำลังส่งรหัส OTP ใหม่ไปยัง Gmail ของคุณ...");
  try {
    const p = otpVerifyContext.payload;
    const res = await fetch("/api/auth/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: otpVerifyContext.mode === "signup" ? "register" : otpVerifyContext.mode,
        userId: p.userId || null,
        oldEmail: p.oldEmail || "",
        oldUsername: p.oldUsername || "",
        username: p.username || "",
        email: otpVerifyContext.email,
        phone: p.phone || "",
        password: p.password || "12345678"
      })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showToast("ส่งรหัส OTP 6 หลักใหม่เข้า Gmail เรียบร้อยแล้ว!");
    } else {
      showToast(data.message || "ไม่สามารถส่งรหัส OTP ซ้ำได้");
    }
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการส่งรหัส OTP");
  }
}

// 1) ตอนสมัครสมาชิกใหม่ (SIGN UP) -> ตรวจรหัสผ่าน >= 8 ตัว + ส่ง OTP เข้า Gmail จริง
handleUserRegister = async function (event) {
  event.preventDefault();
  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  const phone = document.getElementById("regPhone").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmEl = document.getElementById("regConfirmPassword");
  const confirmPass = confirmEl ? confirmEl.value : password;
  const errEl = document.getElementById("regErrorMsg");

  if (password.length < 8) {
    errEl.textContent = "รหัสผ่าน (PASSWORD) ต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป";
    errEl.classList.remove("hidden");
    return;
  }

  if (password !== confirmPass) {
    errEl.textContent = "รหัสผ่าน (PASSWORD) และยืนยันรหัสผ่าน (CONFIRM) ไม่ตรงกัน";
    errEl.classList.remove("hidden");
    return;
  }

  errEl.textContent = "กำลังตรวจสอบข้อมูลและส่งรหัส OTP ไปยัง Gmail ของคุณ...";
  errEl.classList.remove("hidden");

  try {
    const preRes = await fetch("/api/auth/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "register", username, email, phone, password })
    });
    const preData = await preRes.json();
    if (!preRes.ok || !preData.ok) {
      errEl.textContent = preData.message || "ไม่สามารถส่งรหัส OTP ได้";
      errEl.classList.remove("hidden");
      return;
    }

    errEl.classList.add("hidden");
    closeModal("authModal");
    openRealOtpModalUI("signup", email, { username, email, phone, password });
    showToast(`ส่งรหัส OTP ไปที่ ${email} แล้ว กรุณาตรวจสอบใน Gmail ของคุณ`);
  } catch (e) {
    errEl.textContent = "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้";
    errEl.classList.remove("hidden");
  }
};

// 2) ตอนกดปุ่ม Google ('G') -> เปิดหน้าต่างเลือกบัญชี Google ของจริง + ส่ง OTP เข้า Gmail จริง
handleGoogleQuickLogin = async function () {
  // กฎของ Google OAuth บังคับให้ใช้ localhost แทน 127.0.0.1
  if (window.location.hostname === "127.0.0.1") {
    if (confirm("ระบบความปลอดภัยของ Google กำหนดให้ต้องเปิดผ่าน http://localhost:5000\nต้องการสลับไปยังหน้า localhost:5000 ทันทีหรือไม่?")) {
      window.location.href = window.location.href.replace("127.0.0.1", "localhost");
    }
    return;
  }

  const clientId = await fetchGoogleClientIdConfig();
  if (!clientId || clientId.includes("ใส่_CLIENT_ID")) {
    alert("กรุณานำรหัส GOOGLE_CLIENT_ID ของคุณไปใส่ในไฟล์ app.py ก่อนใช้งานปุ่มล็อกอิน Google จริงครับ");
    return;
  }

  if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
    showToast("กำลังโหลดระบบ Google OAuth กรุณาลองคลิกอีกครั้งใน 2 วินาที");
    return;
  }

  googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: "openid email profile",
    callback: async tokenResponse => {
      if (!tokenResponse || !tokenResponse.access_token) return;
      showToast("กำลังตรวจสอบบัญชี Google และส่งรหัส OTP ไปยัง Gmail ของคุณ...");

      try {
        const res = await fetch("/api/auth/google-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: tokenResponse.access_token })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || "ไม่สามารถเชื่อมต่อบัญชี Google ได้");
          return;
        }

        const gUser = data.googleUser;
        const randomPhone = "089" + Math.floor(1000000 + Math.random() * 8999999);
        const randomPass = "HB@" + Math.floor(10000000 + Math.random() * 89999999);

        closeModal("authModal");
        openRealOtpModalUI("google", gUser.email, {
          username: gUser.username,
          email: gUser.email,
          phone: randomPhone,
          password: randomPass,
          avatar: gUser.avatar
        });
        showToast(`ส่งรหัส OTP 6 หลักไปยัง ${gUser.email} เรียบร้อยแล้ว!`);
      } catch (e) {
        showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ Google");
      }
    }
  });

  googleTokenClient.requestAccessToken({ prompt: "select_account" });
};

// 3) ตอนกด "บันทึกข้อมูล" ในหน้า "บัญชี&และความปลอดภัย" -> ตรวจรหัสผ่าน >= 8 ตัว + ส่ง OTP เข้า Gmail จริง
saveProfileSecurity = async function (event) {
  event.preventDefault();
  if (!currentUser) return;

  const username = document.getElementById("profUsername").value.trim();
  const phone = document.getElementById("profPhone").value.trim();
  const email = document.getElementById("profEmail").value.trim().toLowerCase();
  const password = document.getElementById("profPassword").value;

  if (password.length < 8) {
    showToast("รหัสผ่าน (PASSWORED) ต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป");
    return;
  }

  showToast("กำลังตรวจสอบข้อมูลและส่งรหัส OTP ไปยัง Gmail...");

  try {
    const preRes = await fetch("/api/auth/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "security",
        userId: currentUser.user_id || null,
        oldEmail: currentUser.email || "",
        oldUsername: currentUser.username || "",
        username,
        email,
        phone,
        password
      })
    });
    const preData = await preRes.json();
    if (!preRes.ok || !preData.ok) {
      showToast(preData.message || "ไม่สามารถส่งรหัส OTP ได้");
      return;
    }

    openRealOtpModalUI("security", email, {
      userId: currentUser.user_id || null,
      oldEmail: currentUser.email || "",
      oldUsername: currentUser.username || "",
      username,
      phone,
      email,
      password,
      currentPassword: currentUser.password || password
    });
    showToast(`ส่งรหัส OTP 6 หลักไปที่ ${email} แล้ว`);
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการตรวจสอบข้อมูล");
  }
};

// 4) ตรวจสอบรหัส OTP 6 หลักที่ผู้ใช้กรอก กับเซิร์ฟเวอร์จริง
confirmUserSignupOtp = async function (event) {
  event.preventDefault();
  const enteredOtp = document.getElementById("signupOtpInput").value.trim();
  const errEl = document.getElementById("signupOtpErrorMsg");

  try {
    const verifyRes = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: otpVerifyContext.email,
        otp: enteredOtp
      })
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.ok) {
      errEl.textContent = verifyData.message || "รหัส OTP 6 หลักไม่ถูกต้อง";
      errEl.classList.remove("hidden");
      return;
    }

    const { mode, payload } = otpVerifyContext;

    if (mode === "signup") {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        closeModal("userSignupOtpModal");
        openAuthModal("register");
        const regErr = document.getElementById("regErrorMsg");
        regErr.textContent = data.message || "ไม่สามารถสมัครสมาชิกได้";
        regErr.classList.remove("hidden");
        return;
      }

      currentUser = data.user;
      cart = [];
      saveUserSession();
      updateAuthUI();
      updateCartBadgeUI();
      closeModal("userSignupOtpModal");
      showToast("ยืนยัน OTP 6 หลักและสร้างบัญชีผู้ใช้งานสำเร็จ!");
    } else if (mode === "google") {
      const profRes = await fetch(`/api/profile/full?email=${encodeURIComponent(payload.email)}&username=${encodeURIComponent(payload.username)}`);
      if (profRes.ok) {
        const profData = await profRes.json();
        if (profData.ok && profData.user) {
          currentUser = profData.user;
        }
      }

      if (currentUser) {
        const savedCart = localStorage.getItem(`hb_cart_${currentUser.email}`);
        cart = savedCart ? JSON.parse(savedCart) : [];
        saveUserSession();
        updateAuthUI();
        updateCartBadgeUI();
        await refreshUnreadNotificationBadge();
        closeModal("userSignupOtpModal");
        showToast(`เข้าสู่ระบบด้วย Google สำเร็จ! ยินดีต้อนรับคุณ ${currentUser.username}`);
      }
    } else if (mode === "security") {
      const res = await fetch("/api/profile/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        closeModal("userSignupOtpModal");
        showToast(data.message || "ไม่สามารถบันทึกข้อมูลบัญชีได้");
        return;
      }

      currentUser = { ...currentUser, ...data.user };
      saveUserSession();
      updateAuthUI();
      document.getElementById("profHeaderName").textContent = currentUser.username;
      document.getElementById("profHeaderEmail").textContent = currentUser.email;

      const passInput = document.getElementById("profPassword");
      const eyeIcon = document.getElementById("profPassEyeIcon");
      if (passInput) passInput.type = "password";
      if (eyeIcon) eyeIcon.className = "fa-solid fa-eye-slash text-xs";

      closeModal("userSignupOtpModal");
      showToast("ยืนยัน OTP 6 หลักและบันทึกข้อมูลบัญชีเรียบร้อยแล้ว!");
    }
  } catch (e) {
    errEl.textContent = "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์";
    errEl.classList.remove("hidden");
  }
};
// ============================================================================
// 15. ระบบลืมรหัสผ่าน (เชื่อมกับ onclick="openSupportRequestModal()" โดยตรง)
// ============================================================================
let forgotPasswordTargetEmail = "";

function ensureForgotPasswordModalExists() {
  if (document.getElementById("forgotSupportModal")) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div id="forgotSupportModal" class="fixed inset-0 z-[75] hidden bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div class="relative w-full max-w-md bg-black border-2 border-white/20 rounded-[36px] p-7 sm:p-8 shadow-2xl text-white">
        <button type="button" onclick="closeModal('forgotSupportModal')" class="absolute top-5 right-5 w-8 h-8 rounded-full bg-zinc-800 hover:bg-hbOrange text-white flex items-center justify-center transition">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <div class="text-center mb-5">
          <span class="px-3 py-1 rounded-full bg-hbOrange/20 text-hbGold text-xs font-extrabold tracking-wider">RESET PASSWORD</span>
          <h3 class="text-2xl font-extrabold text-white mt-2">ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่</h3>
          <p class="text-xs text-gray-400 mt-1">ยืนยันตัวตนด้วยรหัส OTP 6 หลักทาง Gmail เพื่อตั้งรหัสผ่านใหม่ด้วยตัวเอง</p>
        </div>
        <form id="forgotStep1Form" onsubmit="requestForgotPasswordOtp(event)" class="space-y-4">
          <div>
            <label class="block text-xs font-extrabold text-gray-200 mb-1.5 tracking-wide">GMAIL หรือ USERNAME ของคุณ</label>
            <input id="forgotIdentifierInput" type="text" required placeholder="กรอก Gmail หรือชื่อผู้ใช้งานที่ลงทะเบียนไว้..." class="w-full bg-black border-2 border-white rounded-full py-3 px-5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-hbGold" />
          </div>
          <p id="forgotStep1Error" class="text-xs text-red-400 font-bold text-center hidden"></p>
          <button id="forgotSendOtpBtn" type="submit" class="w-full py-3.5 rounded-full bg-white hover:bg-hbGold text-black font-extrabold text-sm sm:text-base tracking-wide transition shadow-lg">
            ส่งรหัส OTP 6 หลักไปยัง Gmail
          </button>
        </form>
        <form id="forgotStep2Form" onsubmit="confirmForgotPasswordReset(event)" class="hidden space-y-4">
          <div class="bg-zinc-900 border border-white/15 rounded-2xl p-3 text-center">
            <p class="text-xs text-gray-300">ส่งรหัส OTP 6 หลักไปที่อีเมล:</p>
            <p id="forgotTargetEmailLabel" class="text-sm font-extrabold text-hbGold mt-0.5"></p>
          </div>
          <div>
            <label class="block text-xs font-extrabold text-gray-200 mb-1 tracking-wide">รหัส OTP 6 หลัก (จากใน Gmail)</label>
            <input id="forgotOtpCodeInput" type="text" maxlength="6" required placeholder="000000" class="w-full bg-zinc-900 border-2 border-white rounded-full py-2.5 px-5 text-center tracking-[0.45em] text-lg font-extrabold text-white focus:outline-none focus:border-hbGold" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-extrabold text-gray-200 mb-1">NEW PASSWORD (8+ ตัว)</label>
              <input id="forgotNewPassInput" type="password" required minlength="8" placeholder="อย่างน้อย 8 ตัวอักษร" class="w-full bg-black border-2 border-white rounded-full py-2.5 px-4 text-xs sm:text-sm text-white focus:outline-none focus:border-hbGold" />
            </div>
            <div>
              <label class="block text-xs font-extrabold text-gray-200 mb-1">CONFIRM PASSWORD</label>
              <input id="forgotConfirmPassInput" type="password" required minlength="8" placeholder="ยืนยันรหัสผ่านใหม่" class="w-full bg-black border-2 border-white rounded-full py-2.5 px-4 text-xs sm:text-sm text-white focus:outline-none focus:border-hbGold" />
            </div>
          </div>
          <p id="forgotStep2Error" class="text-xs text-red-400 font-bold text-center hidden"></p>
          <div class="flex gap-3 pt-1">
            <button type="button" onclick="backToForgotStep1()" class="w-1/3 py-3 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs sm:text-sm transition">ย้อนกลับ</button>
            <button type="submit" class="w-2/3 py-3 rounded-full bg-hbOrange hover:bg-hbOrangeHover text-white font-extrabold text-xs sm:text-sm transition shadow-lg">ยืนยันเปลี่ยนรหัสผ่านใหม่</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper.firstElementChild);
}

function handleOpenForgotPasswordModal() {
  ensureForgotPasswordModalExists();
  closeModal("authModal");
  closeModal("supportRequestModal");
  forgotPasswordTargetEmail = "";

  const f1 = document.getElementById("forgotStep1Form");
  const f2 = document.getElementById("forgotStep2Form");
  const idInput = document.getElementById("forgotIdentifierInput");
  const err1 = document.getElementById("forgotStep1Error");
  const err2 = document.getElementById("forgotStep2Error");

  if (f1) f1.classList.remove("hidden");
  if (f2) f2.classList.add("hidden");
  if (idInput) idInput.value = document.getElementById("loginUsername")?.value.trim() || "";
  if (err1) err1.classList.add("hidden");
  if (err2) err2.classList.add("hidden");

  openModal("forgotSupportModal");
}

// เชื่อมทั้ง 2 ชื่อฟังก์ชันให้เปิดหน้าต่างขอ OTP ตั้งรหัสผ่านใหม่ได้ทันที
openSupportRequestModal = handleOpenForgotPasswordModal;
openForgotSupportModal = handleOpenForgotPasswordModal;

function backToForgotStep1() {
  document.getElementById("forgotStep1Form")?.classList.remove("hidden");
  document.getElementById("forgotStep2Form")?.classList.add("hidden");
}

async function requestForgotPasswordOtp(event) {
  event.preventDefault();
  const identifier = document.getElementById("forgotIdentifierInput").value.trim();
  const errEl = document.getElementById("forgotStep1Error");
  const btnEl = document.getElementById("forgotSendOtpBtn");

  errEl.textContent = "กำลังค้นหาบัญชีและส่งรหัส OTP ไปยัง Gmail ของคุณ...";
  errEl.className = "text-xs text-amber-300 font-bold text-center";
  errEl.classList.remove("hidden");
  if (btnEl) btnEl.disabled = true;

  try {
    const res = await fetch("/api/auth/forgot-password/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier })
    });
    const data = await res.json();
    if (btnEl) btnEl.disabled = false;

    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "ไม่สามารถส่งรหัส OTP ได้";
      errEl.className = "text-xs text-red-400 font-bold text-center";
      errEl.classList.remove("hidden");
      return;
    }

    forgotPasswordTargetEmail = data.email;
    document.getElementById("forgotTargetEmailLabel").textContent = data.email;
    document.getElementById("forgotOtpCodeInput").value = "";
    document.getElementById("forgotNewPassInput").value = "";
    document.getElementById("forgotConfirmPassInput").value = "";
    document.getElementById("forgotStep2Error").classList.add("hidden");

    document.getElementById("forgotStep1Form").classList.add("hidden");
    document.getElementById("forgotStep2Form").classList.remove("hidden");
    showToast(`ส่งรหัส OTP 6 หลักไปยัง ${data.email} แล้ว`);
  } catch (e) {
    if (btnEl) btnEl.disabled = false;
    errEl.textContent = "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์";
    errEl.className = "text-xs text-red-400 font-bold text-center";
    errEl.classList.remove("hidden");
  }
}

async function confirmForgotPasswordReset(event) {
  event.preventDefault();
  const otp = document.getElementById("forgotOtpCodeInput").value.trim();
  const newPassword = document.getElementById("forgotNewPassInput").value;
  const confirmPassword = document.getElementById("forgotConfirmPassInput").value;
  const errEl = document.getElementById("forgotStep2Error");

  if (newPassword.length < 8) {
    errEl.textContent = "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป";
    errEl.classList.remove("hidden");
    return;
  }

  if (newPassword !== confirmPassword) {
    errEl.textContent = "รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    const res = await fetch("/api/auth/forgot-password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: forgotPasswordTargetEmail,
        otp,
        newPassword
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "ไม่สามารถเปลี่ยนรหัสผ่านได้";
      errEl.classList.remove("hidden");
      return;
    }

    closeModal("forgotSupportModal");
    openAuthModal("login");
    const loginUserEl = document.getElementById("loginUsername");
    const loginPassEl = document.getElementById("loginPassword");
    if (loginUserEl) loginUserEl.value = forgotPasswordTargetEmail;
    if (loginPassEl) loginPassEl.value = "";
    showToast("ตั้งรหัสผ่านใหม่สำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่ของคุณ");
  } catch (e) {
    errEl.textContent = "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์";
    errEl.classList.remove("hidden");
  }
}
// ============================================================================
// 16. ระบบออกจากระบบอัตโนมัติและพักหน้าเว็บเมื่อไม่มีการใช้งานครบ 10 นาที (Idle Timeout)
// ============================================================================
const IDLE_TIMEOUT_MINUTES = 10; // ตั้งเวลาไม่ใช้งาน (นาที) - หากต้องการทดสอบไวๆ ลองเปลี่ยนเป็น 0.2 (12 วินาที)
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;
let idleTimeoutTimer = null;
let lastActivityTime = Date.now();

function createIdleLockOverlay() {
  if (document.getElementById("hbIdleLockOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "hbIdleLockOverlay";
  overlay.className =
    "fixed inset-0 z-[999] hidden bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center text-white select-none";
  overlay.innerHTML = `
    <div class="max-w-md w-full bg-zinc-900 border-2 border-white/15 rounded-[36px] p-8 shadow-2xl space-y-5">
      <div class="w-16 h-16 rounded-full bg-red-600/20 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto text-3xl">
        <i class="fa-solid fa-clock-rotate-left"></i>
      </div>
      <div class="space-y-2">
        <h3 class="text-2xl font-extrabold text-hbGold">ตัดการเชื่อมต่ออัตโนมัติ</h3>
        <p class="text-xs sm:text-sm text-gray-300 leading-relaxed">
          เนื่องจากไม่มีการใช้งานหน้าเว็บเกิน <strong>${IDLE_TIMEOUT_MINUTES} นาที</strong> ระบบจึงได้ออกจากระบบอัตโนมัติเพื่อความปลอดภัยของบัญชีคุณ
        </p>
      </div>
      <div class="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          type="button"
          onclick="resumeFromIdleLock(false)"
          class="w-full py-3 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs sm:text-sm transition"
        >
          กลับสู่หน้าแรก
        </button>
        <button
          type="button"
          onclick="resumeFromIdleLock(true)"
          class="w-full py-3 rounded-full bg-hbOrange hover:bg-hbOrangeHover text-white font-extrabold text-xs sm:text-sm transition shadow-lg"
        >
          เข้าสู่ระบบใหม่
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function triggerIdleAutoLogoutAndClose() {
  // 1. ล้างข้อมูลการเข้าสู่ระบบ (ออกจากระบบอัตโนมัติ)
  if (typeof currentUser !== "undefined" && currentUser) {
    currentUser = null;
    localStorage.removeItem("hb_current_user");
    if (typeof cart !== "undefined") cart = [];
    if (typeof updateAuthUI === "function") updateAuthUI();
    if (typeof updateCartBadgeUI === "function") updateCartBadgeUI();
  }

  // 2. ปิดหน้าต่างป๊อปอัป (Modal) ทุกอันที่เปิดค้างไว้
  const openModals = [
    "profileModal",
    "checkoutModal",
    "cartModal",
    "productDetailModal",
    "ordersHistoryModal",
    "notificationsModal",
    "authModal",
    "userSignupOtpModal",
    "forgotSupportModal",
    "cancelRefundModal",
    "reviewStarModal"
  ];
  openModals.forEach(id => {
    if (typeof closeModal === "function") closeModal(id);
  });

  // 3. สั่งปิดแท็บเว็บ (กรณีเบราว์เซอร์อนุญาต) และแสดงหน้าจอตัดการเชื่อมต่ออัตโนมัติ
  try {
    window.close();
  } catch (e) {}

  createIdleLockOverlay();
  const overlay = document.getElementById("hbIdleLockOverlay");
  if (overlay) overlay.classList.remove("hidden");
  if (typeof showToast === "function") {
    showToast(`ออกจากระบบอัตโนมัติเนื่องจากไม่มีการใช้งานเกิน ${IDLE_TIMEOUT_MINUTES} นาที`);
  }
}

function resumeFromIdleLock(openLogin = false) {
  const overlay = document.getElementById("hbIdleLockOverlay");
  if (overlay) overlay.classList.add("hidden");
  resetUserIdleTimer();
  if (openLogin && typeof openAuthModal === "function") {
    openAuthModal("login");
  }
}

function resetUserIdleTimer() {
  const overlay = document.getElementById("hbIdleLockOverlay");
  if (overlay && !overlay.classList.contains("hidden")) return;

  lastActivityTime = Date.now();
  localStorage.setItem("hb_last_active_time", String(lastActivityTime));

  if (idleTimeoutTimer) clearTimeout(idleTimeoutTimer);
  idleTimeoutTimer = setTimeout(() => {
    triggerIdleAutoLogoutAndClose();
  }, IDLE_TIMEOUT_MS);
}

// ตรวจสอบทันทีเมื่อผู้ใช้สลับแท็บกลับมาหลังจากเปิดทิ้งไว้นานเกิน 10 นาที
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    const savedLastActive = Number(localStorage.getItem("hb_last_active_time") || lastActivityTime);
    if (Date.now() - savedLastActive >= IDLE_TIMEOUT_MS) {
      triggerIdleAutoLogoutAndClose();
    } else {
      resetUserIdleTimer();
    }
  }
});

// ดักจับการเคลื่อนไหวของผู้ใช้ทุกประเภทเพื่อรีเซ็ตเวลานับถอยหลัง 10 นาที
["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"].forEach(evtName => {
  window.addEventListener(evtName, resetUserIdleTimer, { passive: true });
});

window.addEventListener("DOMContentLoaded", () => {
  createIdleLockOverlay();
  resetUserIdleTimer();
});

// ============================================================================
// 17. ฟังก์ชันเปิดหน้าต่างติดต่อแอดมินผ่าน LINE
// ============================================================================
function openLineContactModal() {
  openModal("lineContactModal");
}
// ============================================================================
// 17. ระบบเชื่อมข้อมูลหน้าต่างรายละเอียดสินค้า (#productDetailModal) ให้รองรับทุกโครงสร้าง HTML
// ============================================================================
let currentActiveDetailProduct = null;
let currentSelectedHorseVariant = "sire";
currentDetailQty = 1;

function findProductByIdCompat(productId) {
  const lists = [
    typeof allProducts !== "undefined" ? allProducts : null,
    typeof products !== "undefined" ? products : null,
    typeof catalogProducts !== "undefined" ? catalogProducts : null,
    window.allProducts,
    window.products
  ];
  for (const list of lists) {
    if (Array.isArray(list)) {
      const found = list.find(p => String(p.id) === String(productId) || String(p.product_id) === String(productId));
      if (found) return found;
    }
  }
  return null;
}

function populateCompactProductDetailModal(product) {
  if (!product) return;
  currentActiveDetailProduct = product;
  currentSelectedHorseVariant = "sire";
  currentDetailQty = 1;

  // กรณีใช้ HTML ชุดใหม่ที่มี id="detTitle"
  const detTitle = document.getElementById("detTitle");
  if (!detTitle) return;

  const isHorse = (product.type || product.category || "").toLowerCase().includes("horse") ||
                  (product.category || "").includes("racing") ||
                  (product.category || "").includes("show") ||
                  Boolean(product.sireName || product.damName || product.vaccine);

  const mainImg = document.getElementById("detImage");
  const thumbsBox = document.getElementById("detThumbnails");
  const ratingEl = document.getElementById("detRating");
  const stockEl = document.getElementById("detStock");
  const priceEl = document.getElementById("detPrice");
  const descEl = document.getElementById("detDescription");
  const vacBox = document.getElementById("detVaccineBox");
  const vacEl = document.getElementById("detVaccine");
  const horseVarBox = document.getElementById("detHorseVariants");
  const prodVarBox = document.getElementById("detProductVariants");
  const qtyInput = document.getElementById("detQtyInput");

  const gallery = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : [product.image || product.img || ""];

  if (mainImg) mainImg.src = gallery[0] || "";
  if (thumbsBox) {
    thumbsBox.innerHTML = gallery
      .slice(0, 4)
      .map(
        (imgUrl, idx) => `
        <img
          src="${imgUrl}"
          onclick="document.getElementById('detImage').src='${imgUrl}'"
          class="w-16 h-14 rounded-xl object-cover border-2 ${idx === 0 ? "border-hbGold" : "border-white/20"} cursor-pointer hover:border-hbOrange transition shrink-0"
        />
      `
      )
      .join("");
  }

  detTitle.textContent = product.title || product.name || "";
  const ratingVal = Number(product.rating || 5.0).toFixed(1);
  if (ratingEl) ratingEl.innerHTML = `★★★★★ <span class="font-bold">(${ratingVal})</span>`;

  const stockCount = product.stock !== undefined ? Number(product.stock) : 1;
  const unitText = isHorse ? "ตัว" : "ชิ้น";
  if (stockEl) stockEl.textContent = `คงเหลือ ${stockCount} ${unitText}`;

  const priceVal = Number(product.price || 0);
  if (priceEl) priceEl.textContent = `${priceVal.toLocaleString("th-TH")} ฿`;
  if (descEl) descEl.textContent = product.description || product.desc || "-";

  if (isHorse) {
    if (horseVarBox) horseVarBox.classList.remove("hidden");
    if (prodVarBox) prodVarBox.classList.add("hidden");
    if (vacBox) vacBox.classList.remove("hidden");
    if (vacEl) {
      vacEl.textContent =
        product.vaccine ||
        "วัคซีนไข้หวัดม้า (Equine Influenza), วัคซีนโรคบาดทะยัก (Tetanus), วัคซีนโรคเยื่อหุ้มสมองอักเสบ (JE), วัคซีนโรคพิษสุนัขบ้า (Rabies)";
    }
    selectHorseVariant("sire");
  } else {
    if (horseVarBox) horseVarBox.classList.add("hidden");
    if (vacBox) vacBox.classList.add("hidden");
  }

  if (qtyInput) qtyInput.value = "1";
  openModal("productDetailModal");
}

function selectHorseVariant(variantType) {
  currentSelectedHorseVariant = variantType;
  const btnSire = document.getElementById("btnVariantSire");
  const btnDam = document.getElementById("btnVariantDam");
  const nameEl = document.getElementById("detHorseName");
  const ageEl = document.getElementById("detHorseAge");

  if (btnSire && btnDam) {
    if (variantType === "sire") {
      btnSire.className = "py-2 rounded-xl border-2 border-hbOrange bg-hbOrange text-white font-extrabold text-xs transition shadow";
      btnDam.className = "py-2 rounded-xl border border-white/25 bg-black text-white hover:border-white/50 transition font-bold text-xs";
    } else {
      btnDam.className = "py-2 rounded-xl border-2 border-hbOrange bg-hbOrange text-white font-extrabold text-xs transition shadow";
      btnSire.className = "py-2 rounded-xl border border-white/25 bg-black text-white hover:border-white/50 transition font-bold text-xs";
    }
  }

  if (currentActiveDetailProduct) {
    const p = currentActiveDetailProduct;
    if (variantType === "sire") {
      if (nameEl) nameEl.textContent = p.sireName || p.horseName || p.title || "Silver Snow";
      if (ageEl) ageEl.textContent = p.sireAge || p.age || "4 ปี";
    } else {
      if (nameEl) nameEl.textContent = p.damName || `${p.title || "Horse"} (Lady)`;
      if (ageEl) ageEl.textContent = p.damAge || p.age || "3 ปี";
    }
  }
}

function adjustDetQty(delta) {
  if (!currentActiveDetailProduct) return;
  const maxStock = Math.max(1, Number(currentActiveDetailProduct.stock || 10));
  currentDetailQty = Math.min(maxStock, Math.max(1, currentDetailQty + delta));
  const qtyInput = document.getElementById("detQtyInput");
  if (qtyInput) qtyInput.value = String(currentDetailQty);
}

function addCurrentDetToCart() {
  if (!currentActiveDetailProduct) return;
  if (typeof addToCart === "function") {
    addToCart(currentActiveDetailProduct.id, currentDetailQty, currentSelectedHorseVariant);
    closeModal("productDetailModal");
    return;
  }
  const p = currentActiveDetailProduct;
  const existing = cart.find(item => String(item.id) === String(p.id));
  if (existing) {
    existing.qty = Number(existing.qty || 1) + currentDetailQty;
  } else {
    cart.push({
      id: p.id,
      title: p.title || p.name,
      price: Number(p.price || 0),
      image: (Array.isArray(p.images) && p.images[0]) || p.image || "",
      qty: currentDetailQty,
      type: p.type || "horse"
    });
  }
  if (typeof saveUserSession === "function") saveUserSession();
  if (typeof updateCartBadgeUI === "function") updateCartBadgeUI();
  closeModal("productDetailModal");
  if (typeof showToast === "function") showToast("เพิ่มสินค้าลงในตะกร้าเรียบร้อยแล้ว!");
}

function buyCurrentDetNow() {
  addCurrentDetToCart();
  if (typeof openCheckoutModal === "function") {
    openCheckoutModal();
  } else if (typeof openCartModal === "function") {
    openCartModal();
  }
}

// ดักจับฟังก์ชันเปิดหน้าต่างรายละเอียดสินค้าให้ทำงานได้ทั้งโครงสร้างเดิมและโครงสร้างใหม่
if (typeof openProductDetail === "function") {
  const _origOpenProductDetail = openProductDetail;
  openProductDetail = async function (productId) {
    try {
      await _origOpenProductDetail(productId);
    } catch (e) {}
    if (document.getElementById("detTitle")) {
      let prod = findProductByIdCompat(productId);
      if (!prod) {
        try {
          const res = await fetch("/api/products");
          const data = await res.json();
          const list = data.products || data || [];
          prod = list.find(p => String(p.id) === String(productId));
        } catch (err) {}
      }
      if (prod) populateCompactProductDetailModal(prod);
    }
  };
}