// ============================================================================
// HORSE BUDDY - ADMIN PANEL SCRIPT (admin.js ฉบับสมบูรณ์ เชื่อมต่อ datauma.db)
// ============================================================================

let adminCatalogHorses = [];
let adminCatalogProducts = [];
let adminNotificationsList = [];
let currentBellTab = "order";
let currentAdminSession = {
  username: "admin_hb",
  display_name: "โกชิป",
  avatar_url: "https://api.dicebear.com/7.x/adventurer/svg?seed=Gochip"
};

// ตัวแปรสำหรับรายงานยอดขาย 3 สไลด์
let currentSalesSlide = 0;
let currentSalesFilter = "all";
let currentSalesPeriod = "daily";
let cachedSalesTableRows = [];
let salesPieChartInstance = null;
let salesLineChartInstance = null;
let lastWheelTime = 0;

// ตัวแปรสำหรับหน้าต่างเพิ่ม/แก้ไขสินค้า
let editingMode = "horse"; // 'horse' หรือ 'product'
let editingCategory = "racing";
let editingItemId = "";
let editingImages = ["", "", "", ""];
let targetUploadSlot = 0;
let currentHorseGenderTab = "sire";
let horseVariantsDraft = {
  sire: { horseName: "", age: "4 ปี", price: 250000, stock: 1, health: "แข็งแรงสมบูรณ์" },
  dam: { horseName: "", age: "3 ปี", price: 230000, stock: 1, health: "แข็งแรงสมบูรณ์" }
};

window.addEventListener("DOMContentLoaded", async () => {
  const savedAdmin = sessionStorage.getItem("hb_admin_session");
  if (savedAdmin) {
    try {
      const adm = JSON.parse(savedAdmin);
      currentAdminSession = { ...currentAdminSession, ...adm };
    } catch (e) {}
  }
  syncAdminProfileHeaderUI();

  // ตั้งค่าวันที่ปัจจุบันแบบ พ.ศ.
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear() + 543;
  const dateEl = document.getElementById("salesCurrentDateText");
  if (dateEl) dateEl.textContent = `ข้อมูลประจำวันที่ ${dd}/${mm}/${yyyy}`;

  // ดักจับลูกกลิ้งเมาส์ (Scroll Wheel) เพื่อเลื่อนดูรายงานการขาย 3 สไลด์
  const salesSection = document.getElementById("admSectionSales");
  if (salesSection) {
    salesSection.addEventListener(
      "wheel",
      e => {
        if (e.target.closest("table") || e.target.closest(".overflow-y-auto")) return;
        const nowTime = Date.now();
        if (nowTime - lastWheelTime < 450) return;
        lastWheelTime = nowTime;

        if (e.deltaY > 0) {
          goToSalesSlide(Math.min(2, currentSalesSlide + 1));
        } else if (e.deltaY < 0) {
          goToSalesSlide(Math.max(0, currentSalesSlide - 1));
        }
      },
      { passive: true }
    );
  }

  await refreshAdminNotificationsAndBadges();
  await loadAdminCatalogData();
});

// ==================== 1. โปรไฟล์แอดมิน (แก้ไขรูปโปรไฟล์ + ออกจากระบบ) ====================
function syncAdminProfileHeaderUI() {
  const nameToShow = currentAdminSession.display_name || currentAdminSession.username || "โกชิป";
  const avatarToShow = currentAdminSession.avatar_url || "https://api.dicebear.com/7.x/adventurer/svg?seed=Gochip";

  const topName = document.getElementById("admTopDisplayName");
  const topAvatar = document.getElementById("admTopAvatar");
  const modalName = document.getElementById("admProfileModalName");
  const modalAvatar = document.getElementById("admProfileModalAvatar");

  if (topName) topName.textContent = `HI ADMIN ${nameToShow}`;
  if (topAvatar) topAvatar.src = avatarToShow;
  if (modalName) modalName.textContent = nameToShow;
  if (modalAvatar) modalAvatar.src = avatarToShow;
}

function openAdminProfileModal() {
  syncAdminProfileHeaderUI();
  document.getElementById("admProfileModal").classList.remove("hidden");
}

function closeAdminProfileModal() {
  document.getElementById("admProfileModal").classList.add("hidden");
}

function triggerAdminAvatarUpload() {
  const fileInput = document.getElementById("admAvatarFileInput");
  if (fileInput) {
    fileInput.value = "";
    fileInput.click();
  }
}

async function handleAdminAvatarChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !file.type.startsWith("image/")) return;

  const base64 = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });

  currentAdminSession.avatar_url = base64;
  syncAdminProfileHeaderUI();
  sessionStorage.setItem("hb_admin_session", JSON.stringify(currentAdminSession));

  try {
    const res = await fetch("/api/admin/avatar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentAdminSession.username || "admin_hb",
        avatar: base64
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.admin) {
        currentAdminSession = { ...currentAdminSession, ...data.admin };
        sessionStorage.setItem("hb_admin_session", JSON.stringify(currentAdminSession));
      }
    }
  } catch (e) {}
}

function handleAdminLogout() {
  sessionStorage.removeItem("hb_admin_session");
  window.location.href = "/";
}

// ==================== 2. เปิด/ปิดแถบเมนูขวา & สลับหน้า ====================
function toggleAdminRightSidebar() {
  const sidebar = document.getElementById("admRightSidebar");
  const btn = document.getElementById("admSidebarToggleBtn");
  const icon = document.getElementById("admSidebarArrowIcon");

  const isClosed = sidebar.classList.contains("sidebar-closed");
  if (isClosed) {
    sidebar.classList.remove("sidebar-closed");
    sidebar.classList.add("sidebar-open");
    btn.style.right = "20rem";
    icon.classList.remove("rotate-180");
  } else {
    sidebar.classList.remove("sidebar-open");
    sidebar.classList.add("sidebar-closed");
    btn.style.right = "0px";
    icon.classList.add("rotate-180");
  }
}

function switchAdminSection(sectionKey) {
  // ตรวจสอบสิทธิ์ของแอดมินก่อนเข้าถึงแต่ละเมนู
  const perms = currentAdminSession.permissions || "all";
  if (sectionKey !== "home" && perms !== "all") {
    const allowedList = perms.split(",").map(s => s.trim());
    if (!allowedList.includes(sectionKey)) {
      alert("⛔ บัญชีแอดมินของคุณไม่ได้รับสิทธิ์ให้เข้าถึงส่วนงานนี้ครับ");
      return;
    }
  }

  const allSections = [
    "admSectionHome",
    "admSectionSales",
    "admSectionProducts",
    "admSectionOrders",
    "admSectionSupport",
    "admSectionSettings",
    "admSectionAdmins",
    "admSectionReviews"
  ];
  allSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });

  document.querySelectorAll(".adm-nav-btn").forEach(btn => {
    btn.classList.remove("text-[#FACC15]");
    btn.classList.add("text-white");
  });
  const activeNavBtn = document.getElementById(`navBtn_${sectionKey}`);
  if (activeNavBtn) {
    activeNavBtn.classList.remove("text-white");
    activeNavBtn.classList.add("text-[#FACC15]");
  }

  const sidebar = document.getElementById("admRightSidebar");
  if (sidebar && sidebar.classList.contains("sidebar-open")) {
    toggleAdminRightSidebar();
  }

  const mapSectionId = {
    home: "admSectionHome",
    sales: "admSectionSales",
    products: "admSectionProducts",
    orders: "admSectionOrders",
    support: "admSectionSupport",
    settings: "admSectionSettings",
    admins: "admSectionAdmins",
    reviews: "admSectionReviews"
  };

  const targetEl = document.getElementById(mapSectionId[sectionKey] || "admSectionHome");
  if (targetEl) targetEl.classList.remove("hidden");

  if (sectionKey === "sales") loadSalesReportData();
  else if (sectionKey === "products") loadAdminCatalogData();
  else if (sectionKey === "orders") loadAdminOrdersData();
  else if (sectionKey === "support") loadAdminSupportAndUsersData();
  else if (sectionKey === "settings") loadAdminFarmSettings();
  else if (sectionKey === "admins") loadAdminStaffList();
  else if (sectionKey === "reviews") loadAdminReviewsData();
}

// ==================== 3. กระดิ่งแจ้งเตือนแอดมิน + จุดแดงบนแถบเมนูขวา ====================
async function refreshAdminNotificationsAndBadges() {
  try {
    const res = await fetch(`/api/admin/notifications?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return;

    adminNotificationsList = data.notifications || [];
    const badges = data.badges || {};

    const bellBadge = document.getElementById("admBellBadge");
    const bellTotal = Number(badges.bellTotal || 0);
    bellBadge.textContent = String(bellTotal);
    if (bellTotal > 0) {
      bellBadge.classList.remove("hidden");
    } else {
      bellBadge.classList.add("hidden");
    }

    // จุดแดง 3 จุดบนเมนูขวา: แสดงเฉพาะเมื่อมีรายการใหม่เข้ามาจริง (> 0) เท่านั้น
    const dotOrders = document.getElementById("badgeDotOrders");
    const dotSupport = document.getElementById("badgeDotSupport");
    const dotReviews = document.getElementById("badgeDotReviews");

    if (Number(badges.approveOrders || 0) > 0) dotOrders.classList.remove("hidden");
    else dotOrders.classList.add("hidden");

    if (Number(badges.supportRequests || 0) > 0) dotSupport.classList.remove("hidden");
    else dotSupport.classList.add("hidden");

    if (Number(badges.reviewsCount || 0) > 0) dotReviews.classList.remove("hidden");
    else dotReviews.classList.add("hidden");

    renderAdminBellList();
  } catch (e) {
    console.warn("Failed to load admin notifications");
  }
}

function toggleAdminBellModal() {
  const modal = document.getElementById("adminBellModal");
  modal.classList.toggle("hidden");
  if (!modal.classList.contains("hidden")) {
    refreshAdminNotificationsAndBadges();
  }
}

function switchAdminBellTab(tabType) {
  currentBellTab = tabType;
  const btnOrder = document.getElementById("bellTabOrders");
  const btnIssue = document.getElementById("bellTabIssues");

  if (tabType === "order") {
    btnOrder.className = "py-2 rounded-full text-xs sm:text-sm font-extrabold admin-pill-active text-white transition";
    btnIssue.className = "py-2 rounded-full text-xs sm:text-sm font-extrabold text-gray-300 hover:text-white transition";
  } else {
    btnIssue.className = "py-2 rounded-full text-xs sm:text-sm font-extrabold admin-pill-active text-white transition";
    btnOrder.className = "py-2 rounded-full text-xs sm:text-sm font-extrabold text-gray-300 hover:text-white transition";
  }
  renderAdminBellList();
}

function renderAdminBellList() {
  const container = document.getElementById("admBellListContainer");
  if (!container) return;

  const filtered = adminNotificationsList.filter(n => n.type === currentBellTab);
  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-center py-10 text-gray-400 text-sm">ไม่มีข้อความแจ้งเตือนในหมวดนี้</p>`;
    return;
  }

  container.innerHTML = filtered
    .map(
      n => `
      <div class="bg-black/60 border border-white/15 rounded-2xl p-3.5 flex items-start justify-between gap-3">
        <div>
          <p class="font-bold text-sm text-amber-400">${n.title}</p>
          <p class="text-xs text-gray-200 mt-0.5">${n.message}</p>
          <p class="text-[10px] text-gray-400 mt-1">${n.created_at}</p>
        </div>
        <button
          onclick="deleteAdminNotificationItem(${n.id})"
          class="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white text-xs font-bold transition shrink-0"
        >
          <i class="fa-solid fa-trash-can"></i> ลบ
        </button>
      </div>
    `
    )
    .join("");
}

async function deleteAdminNotificationItem(notifId) {
  try {
    await fetch(`/api/admin/notifications/${notifId}`, { method: "DELETE" });
    await refreshAdminNotificationsAndBadges();
  } catch (e) {}
}

// ==================== 4. รายงานยอดขาย (3 สไลด์ + กราฟ + ดาวน์โหลดลงชีต) ====================
function setSalesFilter(filterType) {
  currentSalesFilter = filterType;
  document.getElementById("chkBoxHorse").className =
    filterType === "horse" ? "w-3.5 h-3.5 bg-emerald-500 inline-block border border-white" : "w-3.5 h-3.5 bg-white inline-block border border-white";
  document.getElementById("chkBoxOther").className =
    filterType === "other" ? "w-3.5 h-3.5 bg-emerald-500 inline-block border border-white" : "w-3.5 h-3.5 bg-white inline-block border border-white";
  document.getElementById("chkBoxAll").className =
    filterType === "all" ? "w-3.5 h-3.5 bg-emerald-500 inline-block border border-white" : "w-3.5 h-3.5 bg-white inline-block border border-white";
  loadSalesReportData();
}

function setSalesPeriod(period) {
  currentSalesPeriod = period;
  const map = { daily: "periodBtnDaily", monthly: "periodBtnMonthly", yearly: "periodBtnYearly" };
  Object.keys(map).forEach(k => {
    const btn = document.getElementById(map[k]);
    if (k === period) {
      btn.className = "px-6 py-2 rounded-full font-extrabold text-sm sm:text-base admin-pill-active text-white transition";
    } else {
      btn.className = "px-6 py-2 rounded-full font-extrabold text-sm sm:text-base text-white hover:text-orange-400 transition";
    }
  });
  loadSalesReportData();
}

function goToSalesSlide(slideIndex) {
  currentSalesSlide = slideIndex;
  for (let i = 0; i < 3; i++) {
    const slideEl = document.getElementById(`salesSlide${i}`);
    const dotEl = document.getElementById(`salesDot${i}`);
    if (i === slideIndex) {
      slideEl.classList.remove("hidden");
      dotEl.className = "w-3.5 h-3.5 rounded-full bg-amber-500 scale-125 transition";
    } else {
      slideEl.classList.add("hidden");
      dotEl.className = "w-3.5 h-3.5 rounded-full bg-amber-900/70 transition";
    }
  }
}

async function loadSalesReportData() {
  try {
    const res = await fetch(`/api/admin/sales-report?filter=${currentSalesFilter}&period=${currentSalesPeriod}`);
    const data = await res.json();
    if (!data.ok) return;

    const sum = data.summary;
    document.getElementById("cardTotalRevenue").textContent = `฿${Number(sum.totalRevenue).toLocaleString("th-TH")}`;
    document.getElementById("cardTotalQty").textContent = `${Number(sum.totalQty).toLocaleString("th-TH")} ชิ้น`;
    document.getElementById("cardTotalInsurance").textContent = `฿${Number(sum.totalInsurance).toLocaleString("th-TH")}`;
    document.getElementById("cardGrowthPercent").textContent = sum.growthPercent || "+8.6%";

    renderSalesCharts(data.pieChart, data.lineChart);

    cachedSalesTableRows = data.tableRows || [];
    const tbody = document.getElementById("salesOrderTableBody");
    if (cachedSalesTableRows.length === 0) {
      tbody.innerHTML = `
        <tr class="h-14">
          <td class="border-2 border-black p-2 text-center text-gray-400" colspan="6">ยังไม่มีรายการคำสั่งซื้อในหมวดนี้</td>
        </tr>
      `;
    } else {
      tbody.innerHTML = cachedSalesTableRows
        .map(
          r => `
          <tr class="hover:bg-gray-200/60">
            <td class="border-2 border-black p-2.5 text-center font-bold">${r.order_number}</td>
            <td class="border-2 border-black p-2.5 text-center">${r.created_at}</td>
            <td class="border-2 border-black p-2.5 text-center">${r.customer_name}</td>
            <td class="border-2 border-black p-2.5">${r.address}</td>
            <td class="border-2 border-black p-2.5">${r.items_text}</td>
            <td class="border-2 border-black p-2.5 text-right font-bold">฿${Number(r.net_total).toLocaleString("th-TH")}</td>
          </tr>
        `
        )
        .join("");
    }
    document.getElementById("salesTableFooterSum").textContent = `฿${Number(sum.totalRevenue).toLocaleString("th-TH")}`;
  } catch (e) {
    console.warn("Error loading sales report:", e);
  }
}

function renderSalesCharts(pieData, lineData) {
  const pieCtx = document.getElementById("salesPieCanvas");
  const lineCtx = document.getElementById("salesLineCanvas");
  if (!pieCtx || !lineCtx || typeof Chart === "undefined") return;

  if (salesPieChartInstance) salesPieChartInstance.destroy();
  salesPieChartInstance = new Chart(pieCtx, {
    type: "pie",
    data: {
      labels: pieData.labels,
      datasets: [
        {
          data: pieData.values,
          backgroundColor: ["#3B82F6", "#A78BFA", "#FBBF24", "#FDE047", "#FB923C", "#34D399"]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });

  if (salesLineChartInstance) salesLineChartInstance.destroy();
  salesLineChartInstance = new Chart(lineCtx, {
    type: "line",
    data: {
      labels: lineData.labels,
      datasets: [
        {
          label: "รายได้ (บาท)",
          data: lineData.values,
          borderColor: "#3B82F6",
          backgroundColor: "rgba(59, 130, 246, 0.15)",
          tension: 0.35,
          fill: false,
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
}

function exportSalesTableToCSV() {
  const headers = ["หมายเลขออเดอร์", "วัน/เดือน/ปี/เวลา", "ชื่อลูกค้า", "รายละเอียดที่อยู่", "สินค้า(ทั้งหมด)", "ราคาสุทธิ"];
  const rows = cachedSalesTableRows.map(r => [
    r.order_number,
    r.created_at,
    r.customer_name,
    `"${(r.address || "").replace(/"/g, '""')}"`,
    `"${(r.items_text || "").replace(/"/g, '""')}"`,
    r.net_total
  ]);

  let csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `HORSE_BUDDY_Sales_Report_${currentSalesPeriod}.csv`;
  link.click();
}

// ==================== 5. จัดการสินค้า (ม้าแข่ง, ม้าสวยงาม, อาหารสัตว์, อุปกรณ์เสริม + ลักษณะนาม) ====================
async function loadAdminCatalogData() {
  try {
    const res = await fetch(`/api/data?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      adminCatalogHorses = Array.isArray(data.horsesData) ? data.horsesData : [];
      adminCatalogProducts = Array.isArray(data.otherProductsData) ? data.otherProductsData : [];
    }
  } catch (e) {
    console.warn("Cannot load catalog data:", e);
  }
  renderAdminProductGrids();
}

function renderAdminProductGrids() {
  const racingHorses = adminCatalogHorses.filter(h => h.category === "racing");
  const showHorses = adminCatalogHorses.filter(h => h.category === "show");
  const feedProducts = adminCatalogProducts.filter(p => p.category === "feed");
  const equipProducts = adminCatalogProducts.filter(p => p.category === "equipment");

  document.getElementById("admGridRacing").innerHTML =
    racingHorses.map(h => createAdminHorseCardHTML(h)).join("") + createAddCardButtonHTML("horse", "racing");

  document.getElementById("admGridShow").innerHTML =
    showHorses.map(h => createAdminHorseCardHTML(h)).join("") + createAddCardButtonHTML("horse", "show");

  document.getElementById("admGridFeed").innerHTML =
    feedProducts.map(p => createAdminGeneralProductCardHTML(p)).join("") + createAddCardButtonHTML("product", "feed");

  document.getElementById("admGridEquipment").innerHTML =
    equipProducts.map(p => createAdminGeneralProductCardHTML(p)).join("") + createAddCardButtonHTML("product", "equipment");
}

function createAdminHorseCardHTML(horse) {
  const cover = (horse.images && horse.images[0]) || "";
  const sireStock = Number(horse.variants?.sire?.stock ?? 0);
  const damStock = Number(horse.variants?.dam?.stock ?? 0);
  const totalStock = sireStock + damStock;

  return `
    <div
      onclick="openEditHorseModal('${horse.id}')"
      class="bg-black rounded-3xl overflow-hidden shadow-xl cursor-pointer group hover:scale-[1.02] transition border border-white/10"
    >
      <div class="relative aspect-square overflow-hidden bg-zinc-800">
        <img src="${cover}" alt="${horse.breed}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        <span class="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/75 text-white text-xs font-bold">
          คงเหลือ ${totalStock} ตัว
        </span>
      </div>
      <div class="p-4 text-center">
        <h4 class="font-bold text-sm sm:text-base text-white uppercase truncate">${horse.breed}</h4>
        <p class="text-xs sm:text-sm text-gray-200 mt-1">${horse.priceRange}</p>
      </div>
    </div>
  `;
}

function createAdminGeneralProductCardHTML(prod) {
  const unitName = prod.unit || "ชิ้น";
  return `
    <div
      onclick="openEditGeneralProductModal('${prod.id}')"
      class="bg-black rounded-3xl overflow-hidden shadow-xl cursor-pointer group hover:scale-[1.02] transition border border-white/10"
    >
      <div class="relative aspect-square overflow-hidden bg-zinc-800">
        <img src="${prod.image}" alt="${prod.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        <span class="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/75 text-white text-xs font-bold">
          คงเหลือ ${prod.stock} ${unitName}
        </span>
      </div>
      <div class="p-4 text-center">
        <h4 class="font-bold text-sm sm:text-base text-white truncate">${prod.name}</h4>
        <p class="text-xs sm:text-sm text-amber-400 mt-1">${Number(prod.price).toLocaleString("th-TH")} ฿</p>
      </div>
    </div>
  `;
}

function createAddCardButtonHTML(mode, category) {
  return `
    <div
      onclick="openNewAdminItemModal('${mode}', '${category}')"
      class="bg-black rounded-3xl overflow-hidden shadow-xl cursor-pointer group hover:scale-[1.02] transition border-2 border-black flex flex-col justify-between"
    >
      <div class="aspect-square bg-white rounded-t-3xl m-1.5 flex items-center justify-center">
        <span class="text-7xl font-extrabold plus-gradient-text group-hover:scale-110 transition">+</span>
      </div>
      <div class="p-4 text-center">
        <h4 class="font-bold text-sm sm:text-base text-white">เพิ่มสินค้า</h4>
        <p class="text-xs sm:text-sm text-gray-300 mt-1 text-left pl-2">ราคา</p>
      </div>
    </div>
  `;
}

function openNewAdminItemModal(mode, category) {
  editingMode = mode;
  editingCategory = category;
  editingItemId = "";
  editingImages = ["", "", "", ""];

  document.getElementById("admBreedInput").value = "";
  document.getElementById("admPriceInput").value = "";
  document.getElementById("admGeneralStockInput").value = "1";
  document.getElementById("admGeneralUnitInput").value = "ชิ้น";
  document.getElementById("admDescInput").value = "";
  document.getElementById("admVaccineInput").value =
    "วัคซีนไข้หวัดม้า (Equine Influenza), วัคซีนโรคบาดทะยัก (Tetanus), วัคซีนโรคเยื่อหุ้มสมองอักเสบ (JE), วัคซีนโรคพิษสุนัขบ้า (Rabies)";
  document.getElementById("admDeleteItemBtn").classList.add("hidden");

  horseVariantsDraft = {
    sire: { horseName: "", age: "4 ปี", price: 250000, stock: 1, health: "แข็งแรงสมบูรณ์" },
    dam: { horseName: "", age: "3 ปี", price: 230000, stock: 1, health: "แข็งแรงสมบูรณ์" }
  };

  configureModalFieldsByMode();
  switchHorseGenderTab("sire", true);
  renderModalImagePreviews();
  document.getElementById("admProductModal").classList.remove("hidden");
}

function openEditHorseModal(horseId) {
  const horse = adminCatalogHorses.find(h => h.id === horseId);
  if (!horse) return;

  editingMode = "horse";
  editingCategory = horse.category;
  editingItemId = horse.id;
  editingImages = [
    (horse.images && horse.images[0]) || "",
    (horse.images && horse.images[1]) || "",
    (horse.images && horse.images[2]) || "",
    (horse.images && horse.images[3]) || ""
  ];

  document.getElementById("admBreedInput").value = horse.breed || "";
  document.getElementById("admPriceInput").value = horse.priceRange || "";
  document.getElementById("admDescInput").value = horse.description || "";
  document.getElementById("admVaccineInput").value =
    horse.vaccineInfo ||
    "วัคซีนไข้หวัดม้า (Equine Influenza), วัคซีนโรคบาดทะยัก (Tetanus), วัคซีนโรคเยื่อหุ้มสมองอักเสบ (JE), วัคซีนโรคพิษสุนัขบ้า (Rabies)";
  document.getElementById("admDeleteItemBtn").classList.remove("hidden");

  const sireVar = (horse.variants && horse.variants.sire) || {};
  const damVar = (horse.variants && horse.variants.dam) || {};

  horseVariantsDraft = {
    sire: {
      horseName: sireVar.horseName || `${horse.breed} (Sire)`,
      age: sireVar.age || "4 ปี",
      price: sireVar.price || 250000,
      stock: sireVar.stock !== undefined ? sireVar.stock : 1,
      health: sireVar.health || "แข็งแรงสมบูรณ์"
    },
    dam: {
      horseName: damVar.horseName || `${horse.breed} (Dam)`,
      age: damVar.age || "3 ปี",
      price: damVar.price || 230000,
      stock: damVar.stock !== undefined ? damVar.stock : 1,
      health: damVar.health || "แข็งแรงสมบูรณ์"
    }
  };

  configureModalFieldsByMode();
  switchHorseGenderTab("sire", true);
  renderModalImagePreviews();
  document.getElementById("admProductModal").classList.remove("hidden");
}

function openEditGeneralProductModal(prodId) {
  const prod = adminCatalogProducts.find(p => p.id === prodId);
  if (!prod) return;

  editingMode = "product";
  editingCategory = prod.category;
  editingItemId = prod.id;
  editingImages = [prod.image || "", "", "", ""];

  document.getElementById("admBreedInput").value = prod.name || "";
  document.getElementById("admPriceInput").value = prod.price || 0;
  document.getElementById("admGeneralStockInput").value = prod.stock !== undefined ? prod.stock : 1;
  document.getElementById("admGeneralUnitInput").value = prod.unit || "ชิ้น";
  document.getElementById("admDescInput").value = prod.description || "";
  document.getElementById("admDeleteItemBtn").classList.remove("hidden");

  configureModalFieldsByMode();
  renderModalImagePreviews();
  document.getElementById("admProductModal").classList.remove("hidden");
}

function configureModalFieldsByMode() {
  const horseArea = document.getElementById("admHorseVariantsArea");
  const vaccineArea = document.getElementById("admVaccineArea");
  const generalStockArea = document.getElementById("admGeneralStockArea");
  const subImagesRow = document.getElementById("admSubImagesRow");
  const uploadBtnRow = document.getElementById("admUploadBtnRow");
  const titleLabel = document.getElementById("admTitleLabel");
  const descLabel = document.getElementById("admDescLabel");

  if (editingMode === "horse") {
    titleLabel.textContent = "ชื่อสายพันธุ์";
    descLabel.textContent = "คำอธิบายและลักษณะพิเศษสายพันธุ์";
    horseArea.classList.remove("hidden");
    vaccineArea.classList.remove("hidden");
    subImagesRow.classList.remove("hidden");
    uploadBtnRow.classList.remove("hidden");
    generalStockArea.classList.add("hidden");
  } else {
    titleLabel.textContent = "ชื่อสินค้า";
    descLabel.textContent = "คำอธิบายสินค้า";
    horseArea.classList.add("hidden");
    vaccineArea.classList.add("hidden");
    subImagesRow.classList.add("hidden");
    uploadBtnRow.classList.add("hidden");
    generalStockArea.classList.remove("hidden");
  }
}

function closeAdminProductModal() {
  document.getElementById("admProductModal").classList.add("hidden");
}

function syncCurrentGenderDraft() {
  if (editingMode !== "horse") return;
  const g = currentHorseGenderTab;
  horseVariantsDraft[g].horseName = document.getElementById("admVariantHorseName").value;
  horseVariantsDraft[g].age = document.getElementById("admVariantAge").value;
  horseVariantsDraft.sire.stock = parseInt(document.getElementById("admSireStockInput").value || "0", 10);
  horseVariantsDraft.dam.stock = parseInt(document.getElementById("admDamStockInput").value || "0", 10);
}

function saveCurrentGenderDraftWithToast() {
  syncCurrentGenderDraft();
  const label = currentHorseGenderTab === "sire" ? "พ่อพันธุ์" : "แม่พันธุ์";
  alert(`บันทึกข้อมูล "${label}" ไว้ในหน่วยความจำเรียบร้อย! คุณสามารถสลับไปกรอกอีกเพศได้โดยข้อมูลไม่หายครับ`);
}

function switchHorseGenderTab(genderKey, skipSyncFirst = false) {
  if (!skipSyncFirst) {
    syncCurrentGenderDraft();
  }
  currentHorseGenderTab = genderKey;

  const btnSire = document.getElementById("btnTabSire");
  const btnDam = document.getElementById("btnTabDam");
  if (genderKey === "sire") {
    btnSire.className = "px-3 py-1 rounded-xl font-bold text-base sm:text-lg bg-amber-500 text-black transition";
    btnDam.className = "px-3 py-1 rounded-xl font-bold text-base sm:text-lg text-white hover:bg-white/10 transition";
  } else {
    btnDam.className = "px-3 py-1 rounded-xl font-bold text-base sm:text-lg bg-amber-500 text-black transition";
    btnSire.className = "px-3 py-1 rounded-xl font-bold text-base sm:text-lg text-white hover:bg-white/10 transition";
  }

  document.getElementById("admSireStockInput").value = horseVariantsDraft.sire.stock;
  document.getElementById("admDamStockInput").value = horseVariantsDraft.dam.stock;
  document.getElementById("admVariantHorseName").value = horseVariantsDraft[genderKey].horseName || "";
  document.getElementById("admVariantAge").value = horseVariantsDraft[genderKey].age || "";
}

function enforceDigitsOnly(inputEl, genderKey) {
  const cleaned = inputEl.value.replace(/[^0-9]/g, "");
  inputEl.value = cleaned === "" ? "0" : cleaned;
  horseVariantsDraft[genderKey].stock = parseInt(inputEl.value, 10);
}

function stepVariantStock(genderKey, delta) {
  syncCurrentGenderDraft();
  const inputId = genderKey === "sire" ? "admSireStockInput" : "admDamStockInput";
  const el = document.getElementById(inputId);
  const currentVal = parseInt(el.value || "0", 10);
  const nextVal = Math.max(0, currentVal + delta);
  el.value = String(nextVal);
  horseVariantsDraft[genderKey].stock = nextVal;
}

function stepGeneralStock(delta) {
  const el = document.getElementById("admGeneralStockInput");
  const currentVal = parseInt(el.value || "0", 10);
  el.value = String(Math.max(0, currentVal + delta));
}

function triggerAdminImageUpload(slotIndex) {
  targetUploadSlot = slotIndex;
  const fileInput = document.getElementById("admImageFileInput");
  fileInput.value = "";
  fileInput.click();
}

async function handleAdminImagesSelected(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/")) continue;
    const base64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
    const slot = (targetUploadSlot + i) % 4;
    editingImages[slot] = base64;
  }

  renderModalImagePreviews();
}

function renderModalImagePreviews() {
  const mainImg = document.getElementById("admMainImgPreview");
  const mainPlus = document.getElementById("admMainPlusIcon");

  if (editingImages[0]) {
    mainImg.src = editingImages[0];
    mainImg.classList.remove("hidden");
    mainPlus.classList.add("hidden");
  } else {
    mainImg.src = "";
    mainImg.classList.add("hidden");
    mainPlus.classList.remove("hidden");
  }

  for (let i = 0; i < 4; i++) {
    const thumb = document.getElementById(`admThumb${i}`);
    const plus = document.getElementById(`admThumbPlus${i}`);
    if (editingImages[i]) {
      thumb.src = editingImages[i];
      thumb.classList.remove("hidden");
      plus.classList.add("hidden");
    } else {
      thumb.src = "";
      thumb.classList.add("hidden");
      plus.classList.remove("hidden");
    }
  }
}

async function saveAdminProductModal() {
  syncCurrentGenderDraft();

  const title = document.getElementById("admBreedInput").value.trim();
  const rawPrice = document.getElementById("admPriceInput").value.trim();
  const description = document.getElementById("admDescInput").value.trim();

  if (!title || !rawPrice) {
    alert("กรุณากรอกชื่อสินค้า/สายพันธุ์ และราคาให้ครบถ้วน");
    return;
  }

  if (!editingImages[0]) {
    alert("กรุณาคลิกที่กรอบรูปเพื่ออัปโหลดรูปภาพอย่างน้อย 1 รูป");
    return;
  }

  if (editingMode === "horse") {
    const numericPrice = parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 150000;
    horseVariantsDraft.sire.price = numericPrice;
    horseVariantsDraft.dam.price = numericPrice;
    if (!horseVariantsDraft.sire.horseName) horseVariantsDraft.sire.horseName = `${title} (พ่อพันธุ์)`;
    if (!horseVariantsDraft.dam.horseName) horseVariantsDraft.dam.horseName = `${title} (แม่พันธุ์)`;

    const payload = {
      id: editingItemId,
      category: editingCategory,
      breed: title,
      priceRange: rawPrice.includes("฿") ? rawPrice : `${rawPrice} ฿`,
      description: description || "ม้าสายพันธุ์แท้สุขภาพแข็งแรง พร้อมใบรับรอง",
      vaccineInfo: document.getElementById("admVaccineInput").value.trim(),
      images: editingImages.filter(Boolean),
      variants: horseVariantsDraft
    };

    const res = await fetch("/api/admin/save-horse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      localStorage.setItem("hb_catalog_realtime_sync", String(Date.now()));
      closeAdminProductModal();
      await loadAdminCatalogData();
      alert("บันทึกข้อมูลม้าลงฐานข้อมูลสำเร็จ! หน้าเว็บผู้ใช้งานอัปเดตเรียบร้อยแล้ว");
    }
  } else {
    const numericPrice = parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 500;
    const stock = parseInt(document.getElementById("admGeneralStockInput").value || "1", 10);
    const unit = document.getElementById("admGeneralUnitInput").value.trim() || "ชิ้น";

    const payload = {
      id: editingItemId,
      category: editingCategory,
      name: title,
      price: numericPrice,
      stock,
      unit,
      image: editingImages[0],
      description: description || "สินค้าคุณภาพสูงสำหรับม้า"
    };

    const res = await fetch("/api/admin/save-product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      localStorage.setItem("hb_catalog_realtime_sync", String(Date.now()));
      closeAdminProductModal();
      await loadAdminCatalogData();
      alert(`บันทึกข้อมูลสินค้า (${stock} ${unit}) สำเร็จ! หน้าเว็บผู้ใช้งานอัปเดตเรียบร้อยแล้ว`);
    }
  }
}

async function deleteCurrentAdminItem() {
  if (!editingItemId) return;
  if (!confirm("คุณต้องการลบสินค้านี้ออกจากระบบใช่หรือไม่?")) return;

  const url =
    editingMode === "horse"
      ? `/api/admin/delete-horse/${encodeURIComponent(editingItemId)}`
      : `/api/admin/delete-product/${encodeURIComponent(editingItemId)}`;

  const res = await fetch(url, { method: "DELETE" });
  if (res.ok) {
    localStorage.setItem("hb_catalog_realtime_sync", String(Date.now()));
    closeAdminProductModal();
    await loadAdminCatalogData();
  }
}
// ============================================================================
// 🚀 โค้ดควบคุมเฟสแอดมิน ส่วนที่ 2 (เมนูที่ 3 ถึง เมนูที่ 7)
// ============================================================================

let adminAllOrdersCache = [];
let currentAdminOrderSubTab = "pending"; // 'pending' หรือ 'tracking'

// ---------- เมนูที่ 3: อนุมัติสินค้าและติดตามสินค้า ----------
function switchAdminOrderTab(tabKey) {
  currentAdminOrderSubTab = tabKey;
  const btnPending = document.getElementById("ordTabBtnPending");
  const btnTracking = document.getElementById("ordTabBtnTracking");
  const boxPending = document.getElementById("admOrdersPendingContainer");
  const boxTracking = document.getElementById("admOrdersTrackingContainer");

  if (tabKey === "pending") {
    btnPending.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm admin-pill-active text-white transition";
    btnTracking.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm text-white hover:text-amber-300 transition";
    boxPending.classList.remove("hidden");
    boxTracking.classList.add("hidden");
  } else {
    btnTracking.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm admin-pill-active text-white transition";
    btnPending.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm text-white hover:text-amber-300 transition";
    boxPending.classList.add("hidden");
    boxTracking.classList.remove("hidden");
  }
}

async function loadAdminOrdersData() {
  try {
    const res = await fetch(`/api/admin/orders?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return;

    adminAllOrdersCache = data.orders || [];
    const pendingList = adminAllOrdersCache.filter(o => o.status === "pending_approval");
    const trackingList = adminAllOrdersCache.filter(o => o.status !== "pending_approval");

    document.getElementById("ordPendingCountText").textContent = String(pendingList.length);
    document.getElementById("ordTrackingCountText").textContent = String(trackingList.length);

    renderAdminPendingOrders(pendingList);
    renderAdminTrackingOrders(trackingList);
    await refreshAdminNotificationsAndBadges();
  } catch (e) {
    console.warn("Error loading admin orders:", e);
  }
}

function renderAdminPendingOrders(list) {
  const container = document.getElementById("admOrdersPendingContainer");
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `<div class="bg-zinc-900 border border-white/15 rounded-3xl p-10 text-center text-gray-400 text-sm">ไม่มีคำสั่งซื้อที่รอการอนุมัติในขณะนี้</div>`;
    return;
  }

  container.innerHTML = list
    .map(o => {
      const itemsHtml = o.items
        .map(i => `<span class="inline-block bg-black/50 px-2.5 py-1 rounded-lg text-xs mr-2 mb-1">• ${i.title} (x${i.qty})</span>`)
        .join("");
      const hasValidSlip = o.slipImage && o.slipImage.startsWith("data:image");

      return `
        <div class="bg-zinc-900 border-2 border-amber-500/40 rounded-3xl p-6 shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div class="lg:col-span-8 space-y-2.5">
            <div class="flex flex-wrap items-center gap-3">
              <span class="px-3 py-1 rounded-full bg-amber-500 text-black font-extrabold text-xs">${o.orderNumber}</span>
              <span class="font-bold text-base text-white">ลูกค้า: ${o.customerName} (${o.customerPhone})</span>
              <span class="text-xs text-gray-400">${o.createdAt}</span>
            </div>
            <div>${itemsHtml}</div>
            <p class="text-xs text-gray-300">
              <strong class="text-amber-300">การจัดส่ง:</strong> [${o.shippingScope}] ขนส่ง: ${o.transportMode === 'air' ? 'ทางอากาศ (Air Horse One)' : o.transportMode === 'land' ? 'ทางบก (รถม้า HB)' : 'พัสดุ'} • คอก: ${o.stallType} • ระยะทาง ${o.distanceKm} กม.
            </p>
            <p class="text-xs text-gray-300"><strong class="text-amber-300">ที่อยู่จัดส่ง:</strong> ${o.shippingAddress}</p>
            <p class="text-lg font-extrabold text-emerald-400 pt-1">ยอดโอนสุทธิ: ฿${Number(o.grandTotal).toLocaleString("th-TH")}</p>
          </div>

          <div class="lg:col-span-4 flex flex-col items-center lg:items-end justify-between gap-3">
            ${
              hasValidSlip
                ? `<img src="${o.slipImage}" onclick="window.open(this.src)" title="คลิกเพื่อดูรูปสลิปขนาดใหญ่" class="w-36 h-44 object-cover rounded-2xl border-2 border-white/20 cursor-pointer hover:scale-105 transition" />`
                : `<div class="w-36 h-24 rounded-2xl bg-black/50 border border-white/15 flex items-center justify-center text-xs text-gray-400">แนบสลิป: ${o.slipImage || "สำเร็จ"}</div>`
            }
            <div class="flex items-center gap-2.5 w-full lg:w-auto justify-end">
              <button
                onclick="updateOrderStatusByAdmin(${o.orderId}, 'rejected', true)"
                class="px-4 py-2.5 rounded-2xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white font-extrabold text-xs sm:text-sm transition"
              >
                <i class="fa-solid fa-xmark mr-1"></i> ปฏิเสธ/ยกเลิก
              </button>
              <button
                onclick="updateOrderStatusByAdmin(${o.orderId}, 'preparing', true)"
                class="px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs sm:text-sm shadow-lg transition"
              >
                <i class="fa-solid fa-check mr-1"></i> อนุมัติคำสั่งซื้อ
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAdminTrackingOrders(list) {
  const container = document.getElementById("admOrdersTrackingContainer");
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `<div class="bg-zinc-900 border border-white/15 rounded-3xl p-10 text-center text-gray-400 text-sm">ยังไม่มีรายการในหน้าติดตามสินค้า</div>`;
    return;
  }

  const badgeMap = {
    preparing: `<span class="px-3 py-1 rounded-full bg-sky-500/20 text-sky-300 text-xs font-extrabold">1. กำลังเตรียมม้า/ตรวจสุขภาพ</span>`,
    shipping: `<span class="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-extrabold">2. อยู่ระหว่างกำลังขนส่ง</span>`,
    delivered: `<span class="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-extrabold">3. จัดส่งถึงลูกค้าสำเร็จ</span>`,
    rejected: `<span class="px-3 py-1 rounded-full bg-red-500/20 text-red-300 text-xs font-extrabold">ยกเลิก/ปฏิเสธแล้ว</span>`
  };

  container.innerHTML = list
    .map(
      o => `
      <div class="bg-zinc-900 border border-white/15 rounded-3xl p-5 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div class="space-y-1.5">
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="font-extrabold text-base text-amber-400">${o.orderNumber}</span>
            ${badgeMap[o.status] || ""}
            <span class="text-xs text-gray-400">ลูกค้า: ${o.customerName} (${o.customerPhone})</span>
          </div>
          <p class="text-xs text-gray-200">${o.items.map(i => `${i.title} (x${i.qty})`).join(", ")}</p>
          <p class="text-xs text-gray-400">ปลายทาง: ${o.shippingAddress}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onclick="updateOrderStatusByAdmin(${o.orderId}, 'preparing', false)"
            class="px-3.5 py-2 rounded-xl text-xs font-bold border ${o.status === 'preparing' ? 'bg-sky-600 text-white border-sky-400' : 'bg-black/50 text-gray-300 border-white/15 hover:border-sky-400'}"
          >
            1. เตรียมสินค้า
          </button>
          <button
            onclick="updateOrderStatusByAdmin(${o.orderId}, 'shipping', false)"
            class="px-3.5 py-2 rounded-xl text-xs font-bold border ${o.status === 'shipping' ? 'bg-amber-600 text-white border-amber-400' : 'bg-black/50 text-gray-300 border-white/15 hover:border-amber-400'}"
          >
            2. กำลังขนส่ง
          </button>
          <button
            onclick="updateOrderStatusByAdmin(${o.orderId}, 'delivered', false)"
            class="px-3.5 py-2 rounded-xl text-xs font-bold border ${o.status === 'delivered' ? 'bg-emerald-600 text-white border-emerald-400' : 'bg-black/50 text-gray-300 border-white/15 hover:border-emerald-400'}"
          >
            3. จัดส่งสำเร็จ
          </button>
        </div>
      </div>
    `
    )
    .join("");
}

async function updateOrderStatusByAdmin(orderId, nextStatus, moveToTrackingTab = false) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });
    if (res.ok) {
      await loadAdminOrdersData();
      if (moveToTrackingTab && nextStatus === "preparing") {
        switchAdminOrderTab("tracking");
        alert("อนุมัติคำสั่งซื้อเรียบร้อย! รายการถูกย้ายไปยังหน้าติดตามสินค้าและแจ้งเตือนลูกค้าแล้วครับ");
      } else {
        alert("อัปเดตสถานะการจัดส่งและส่งแจ้งเตือนไปยังกระดิ่งของลูกค้าเรียบร้อยแล้ว!");
      }
    }
  } catch (e) {}
}

// ---------- เมนูที่ 4: คำร้องและบัญชีผู้ใช้งาน ----------
function switchAdminSupportTab(tabKey) {
  const btnReq = document.getElementById("supTabBtnRequests");
  const btnUsr = document.getElementById("supTabBtnUsers");
  const boxReq = document.getElementById("admSupportRequestsContainer");
  const boxUsr = document.getElementById("admUsersManageContainer");

  if (tabKey === "requests") {
    btnReq.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm admin-pill-active text-white transition";
    btnUsr.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm text-white hover:text-amber-300 transition";
    boxReq.classList.remove("hidden");
    boxUsr.classList.add("hidden");
  } else {
    btnUsr.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm admin-pill-active text-white transition";
    btnReq.className = "px-5 py-2 rounded-full font-extrabold text-xs sm:text-sm text-white hover:text-amber-300 transition";
    boxReq.classList.add("hidden");
    boxUsr.classList.remove("hidden");
  }
}

async function loadAdminSupportAndUsersData() {
  try {
    const res = await fetch(`/api/admin/support-and-users?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return;

    const reqs = data.supportRequests || [];
    const users = data.users || [];

    const reqBox = document.getElementById("admSupportRequestsContainer");
    if (reqs.length === 0) {
      reqBox.innerHTML = `<div class="bg-zinc-900 border border-white/15 rounded-3xl p-10 text-center text-gray-400 text-sm">ไม่มีคำร้องแจ้งปัญหาจากผู้ใช้งาน</div>`;
    } else {
      reqBox.innerHTML = reqs
        .map(
          r => `
          <div class="bg-zinc-900 border border-white/15 rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2.5">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${r.status === 'pending' ? 'bg-red-600 text-white' : 'bg-emerald-600/30 text-emerald-300'}">
                  ${r.status === 'pending' ? 'รอดำเนินการ' : 'แก้ไขเรียบร้อย'}
                </span>
                <span class="font-extrabold text-sm text-amber-400">${r.reason}</span>
                <span class="text-xs text-gray-400">(${r.created_at})</span>
              </div>
              <p class="text-xs text-white"><strong>ผู้แจ้ง:</strong> ${r.current_username} • <strong>อีเมล/ติดต่อ:</strong> ${r.current_email}</p>
              <p class="text-xs text-gray-300"><strong>รายละเอียด:</strong> ${r.details}</p>
            </div>
            <div class="flex items-center gap-2">
              ${
                r.status === "pending"
                  ? `<button onclick="resolveSupportRequest(${r.request_id})" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition">ทำเครื่องหมายว่าแก้ไขแล้ว</button>`
                  : ""
              }
              <button onclick="deleteSupportRequest(${r.request_id})" class="px-3 py-2 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white text-xs font-bold transition">ลบ</button>
            </div>
          </div>
        `
        )
        .join("");
    }

    const usrBox = document.getElementById("admUsersManageContainer");
    if (users.length === 0) {
      usrBox.innerHTML = `<div class="bg-zinc-900 border border-white/15 rounded-3xl p-10 text-center text-gray-400 text-sm">ยังไม่มีสมาชิกในระบบ</div>`;
    } else {
      usrBox.innerHTML = users
        .map(
          u => `
          <div class="bg-zinc-900 border border-white/15 rounded-3xl p-5 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <div>
                <label class="text-gray-400 block mb-1">Username</label>
                <input id="usrEditName_${u.user_id}" value="${u.username}" class="w-full bg-black/60 border border-white/20 rounded-xl py-2 px-3 text-white font-bold" />
              </div>
              <div>
                <label class="text-gray-400 block mb-1">Gmail</label>
                <input id="usrEditEmail_${u.user_id}" value="${u.email}" class="w-full bg-black/60 border border-white/20 rounded-xl py-2 px-3 text-white" />
              </div>
              <div>
                <label class="text-gray-400 block mb-1">เบอร์โทรศัพท์</label>
                <input id="usrEditPhone_${u.user_id}" value="${u.phone}" class="w-full bg-black/60 border border-white/20 rounded-xl py-2 px-3 text-white" />
              </div>
              <div>
                <label class="text-gray-400 block mb-1">รหัสผ่าน (Password)</label>
                <input id="usrEditPass_${u.user_id}" value="${u.password}" class="w-full bg-black/60 border border-white/20 rounded-xl py-2 px-3 text-amber-300 font-bold" />
              </div>
              <div class="flex items-end gap-2">
                <button onclick="saveUserAccountByAdmin(${u.user_id})" class="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition">
                  บันทึก
                </button>
                <button onclick="deleteUserAccountByAdmin(${u.user_id})" class="px-3 py-2 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white font-bold text-xs transition">
                  ลบ
                </button>
              </div>
            </div>
            <div>
              <input id="usrEditAddr_${u.user_id}" value="${u.address || ''}" placeholder="ที่อยู่จัดส่งของลูกค้า" class="w-full bg-black/40 border border-white/10 rounded-xl py-1.5 px-3 text-xs text-gray-300" />
            </div>
          </div>
        `
        )
        .join("");
    }

    await refreshAdminNotificationsAndBadges();
  } catch (e) {}
}

async function resolveSupportRequest(reqId) {
  await fetch(`/api/admin/support-requests/${reqId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "resolved" })
  });
  await loadAdminSupportAndUsersData();
}

async function deleteSupportRequest(reqId) {
  if (!confirm("ต้องการลบคำร้องนี้ใช่หรือไม่?")) return;
  await fetch(`/api/admin/support-requests/${reqId}`, { method: "DELETE" });
  await loadAdminSupportAndUsersData();
}

async function saveUserAccountByAdmin(userId) {
  const username = document.getElementById(`usrEditName_${userId}`).value.trim();
  const email = document.getElementById(`usrEditEmail_${userId}`).value.trim();
  const phone = document.getElementById(`usrEditPhone_${userId}`).value.trim();
  const password = document.getElementById(`usrEditPass_${userId}`).value.trim();
  const address = document.getElementById(`usrEditAddr_${userId}`).value.trim();

  const res = await fetch(`/api/admin/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, phone, password, address })
  });
  if (res.ok) {
    alert("อัปเดตข้อมูลบัญชีผู้ใช้งานเรียบร้อยแล้ว!");
    await loadAdminSupportAndUsersData();
  }
}

async function deleteUserAccountByAdmin(userId) {
  if (!confirm("ต้องการลบบัญชีผู้ใช้งานนี้ออกจากระบบใช่หรือไม่?")) return;
  await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
  await loadAdminSupportAndUsersData();
}

// ---------- เมนูที่ 5: ตั้งค่าระบบฟาร์มและเรทค่าขนส่ง ----------
async function loadAdminFarmSettings() {
  try {
    const res = await fetch(`/api/settings?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return;
    const s = data.settings || {};

    document.getElementById("setFarmName").value = s.farm_name || "ขอนแก่น (สาขาหลัก)";
    document.getElementById("setFarmLat").value = s.farm_lat || "16.4419";
    document.getElementById("setFarmLng").value = s.farm_lng || "102.8360";

    document.getElementById("setLandBase").value = s.land_base || "3500";
    document.getElementById("setLandPerKm").value = s.land_per_km || "30";
    document.getElementById("setLandShared").value = s.land_stall_shared || "2500";
    document.getElementById("setLandSingle").value = s.land_stall_single || "4500";
    document.getElementById("setLandVip").value = s.land_stall_vip || "16000";

    document.getElementById("setAirBase").value = s.air_base || "150000";
    document.getElementById("setAirPerKm").value = s.air_per_km || "50";
    document.getElementById("setAirShared").value = s.air_stall_shared || "100000";
    document.getElementById("setAirSingle").value = s.air_stall_single || "350000";
    document.getElementById("setAirVip").value = s.air_stall_vip || "777000";
    document.getElementById("setParcelFee").value = s.parcel_fee || "50";
  } catch (e) {}
}

async function saveAdminFarmSettings(event) {
  event.preventDefault();
  const payload = {
    farm_name: document.getElementById("setFarmName").value.trim(),
    farm_lat: document.getElementById("setFarmLat").value,
    farm_lng: document.getElementById("setFarmLng").value,
    land_base: document.getElementById("setLandBase").value,
    land_per_km: document.getElementById("setLandPerKm").value,
    land_stall_shared: document.getElementById("setLandShared").value,
    land_stall_single: document.getElementById("setLandSingle").value,
    land_stall_vip: document.getElementById("setLandVip").value,
    air_base: document.getElementById("setAirBase").value,
    air_per_km: document.getElementById("setAirPerKm").value,
    air_stall_shared: document.getElementById("setAirShared").value,
    air_stall_single: document.getElementById("setAirSingle").value,
    air_stall_vip: document.getElementById("setAirVip").value,
    parcel_fee: document.getElementById("setParcelFee").value
  };

  const res = await fetch("/api/admin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    localStorage.setItem("hb_catalog_realtime_sync", String(Date.now()));
    alert("บันทึกพิกัดฟาร์มและเรทค่าขนส่งเรียบร้อยแล้ว! หน้าชำระเงินของผู้ใช้งานจะคำนวณด้วยเรทใหม่นี้ทันทีครับ");
  }
}

// ---------- เมนูที่ 6: เพิ่มแอดมินและกำหนดสิทธิ์ ----------
async function loadAdminStaffList() {
  try {
    const res = await fetch(`/api/admin/admins?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return;

    const labelMap = {
      all: "เข้าถึงได้ทุกเมนู (Master Admin)",
      sales: "รายงานยอดขาย",
      products: "จัดการสินค้า",
      orders: "อนุมัติ/ติดตามสินค้า",
      support: "คำร้อง/บัญชีผู้ใช้",
      settings: "ตั้งค่าระบบฟาร์ม",
      admins: "เพิ่มแอดมิน",
      reviews: "คำสั่งซื้อและรีวิว"
    };

    const container = document.getElementById("admAdminsListContainer");
    container.innerHTML = (data.admins || [])
      .map(a => {
        const permBadges =
          a.permissions === "all"
            ? `<span class="px-3 py-0.5 rounded-full bg-amber-500 text-black font-extrabold text-xs">${labelMap.all}</span>`
            : (a.permissions || "")
                .split(",")
                .filter(Boolean)
                .map(p => `<span class="px-2.5 py-0.5 rounded-full bg-white/10 text-amber-300 text-xs font-bold">${labelMap[p] || p}</span>`)
                .join(" ");

        return `
          <div class="bg-zinc-900 border border-white/15 rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <img src="${a.avatar_url}" class="w-12 h-12 rounded-full object-cover border border-amber-400 bg-black" />
              <div>
                <h4 class="font-extrabold text-base text-white">${a.display_name} <span class="text-xs text-gray-400">(@${a.username})</span></h4>
                <p class="text-xs text-gray-400">รหัสผ่าน: <strong class="text-amber-300">${a.password}</strong> • อีเมล: ${a.email || "-"}</p>
                <div class="flex flex-wrap gap-1.5 mt-2">${permBadges}</div>
              </div>
            </div>
            <div>
              ${
                a.username === "admin_hb"
                  ? `<span class="text-xs text-gray-500 font-bold">หัวหน้าแอดมินหลัก</span>`
                  : `<button onclick="deleteAdminStaff(${a.admin_id})" class="px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white text-xs font-bold transition"><i class="fa-solid fa-trash mr-1"></i> ลบแอดมิน</button>`
              }
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {}
}

async function handleAddNewAdmin(event) {
  event.preventDefault();
  const username = document.getElementById("newAdmUser").value.trim();
  const password = document.getElementById("newAdmPass").value.trim();
  const display_name = document.getElementById("newAdmDisplay").value.trim();
  const email = document.getElementById("newAdmEmail").value.trim();

  const checkedPerms = Array.from(document.querySelectorAll('input[name="admPermChk"]:checked')).map(el => el.value);
  if (checkedPerms.length === 0) {
    alert("กรุณาเลือกสิทธิ์การเข้าถึงอย่างน้อย 1 เมนู");
    return;
  }

  const res = await fetch("/api/admin/admins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      display_name,
      email,
      permissions: checkedPerms.join(",")
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    alert(data.message || "ไม่สามารถเพิ่มแอดมินได้");
    return;
  }

  document.getElementById("newAdmUser").value = "";
  document.getElementById("newAdmPass").value = "";
  document.getElementById("newAdmDisplay").value = "";
  document.getElementById("newAdmEmail").value = "";
  await loadAdminStaffList();
  alert(`สร้างบัญชีแอดมิน "${display_name}" เรียบร้อยแล้ว!`);
}

async function deleteAdminStaff(adminId) {
  if (!confirm("ต้องการลบบัญชีแอดมินนี้ใช่หรือไม่?")) return;
  const res = await fetch(`/api/admin/admins/${adminId}`, { method: "DELETE" });
  if (res.ok) {
    await loadAdminStaffList();
  }
}

// ---------- เมนูที่ 7: คำสั่งซื้อและจัดการรีวิว ----------
async function loadAdminReviewsData() {
  try {
    const res = await fetch(`/api/admin/reviews?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return;

    const reviews = data.reviews || [];
    const container = document.getElementById("admReviewsListContainer");

    if (reviews.length === 0) {
      container.innerHTML = `<div class="bg-zinc-900 border border-white/15 rounded-3xl p-10 text-center text-gray-400 text-sm">ยังไม่มีรีวิวจากลูกค้าในระบบ</div>`;
    } else {
      container.innerHTML = reviews
        .map(
          r => `
          <div class="bg-zinc-900 border ${r.isHidden ? 'border-red-500/40 opacity-75' : 'border-white/15'} rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div class="space-y-1">
              <div class="flex flex-wrap items-center gap-2.5">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${r.isHidden ? 'bg-red-600 text-white' : 'bg-emerald-600/20 text-emerald-300'}">
                  ${r.isHidden ? 'ซ่อนอยู่ (ไม่แสดงหน้าเว็บ)' : 'แสดงผลปกติ'}
                </span>
                <span class="font-bold text-sm text-amber-400">${r.itemName}</span>
                <span class="text-amber-400 text-sm">${"★".repeat(Number(r.stars || 5))}</span>
              </div>
              <p class="text-sm text-white font-medium">"${r.comment}"</p>
              <p class="text-xs text-gray-400">โดย: <strong>${r.reviewerName}</strong> • วันที่: ${r.date}</p>
            </div>

            <div class="flex items-center gap-2">
              <button
                onclick="toggleReviewHiddenByAdmin(${r.reviewId})"
                class="px-4 py-2 rounded-xl ${r.isHidden ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-gray-200'} text-xs font-bold transition"
              >
                <i class="fa-solid ${r.isHidden ? 'fa-eye' : 'fa-eye-slash'} mr-1"></i> ${r.isHidden ? 'แสดงรีวิว' : 'ซ่อนรีวิว'}
              </button>
              <button
                onclick="deleteReviewByAdmin(${r.reviewId})"
                class="px-3.5 py-2 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white text-xs font-bold transition"
              >
                <i class="fa-solid fa-trash mr-1"></i> ลบ
              </button>
            </div>
          </div>
        `
        )
        .join("");
    }

    await refreshAdminNotificationsAndBadges();
  } catch (e) {}
}

async function toggleReviewHiddenByAdmin(reviewId) {
  await fetch(`/api/admin/reviews/${reviewId}/toggle`, { method: "PUT" });
  localStorage.setItem("hb_catalog_realtime_sync", String(Date.now()));
  await loadAdminReviewsData();
}

async function deleteReviewByAdmin(reviewId) {
  if (!confirm("ต้องการลบรีวิวนี้ออกจากระบบถาวรใช่หรือไม่?")) return;
  await fetch(`/api/admin/reviews/${reviewId}`, { method: "DELETE" });
  localStorage.setItem("hb_catalog_realtime_sync", String(Date.now()));
  await loadAdminReviewsData();
}
// ============================================================================
// ส่วนจัดการคำขอยกเลิกคำสั่งซื้อและขอคืนเงินในหน้าแอดมิน + ซิงค์เรียลไทม์
// ============================================================================
switchAdminOrderTab = function (tabKey) {
  currentAdminOrderSubTab = tabKey;
  const tabs = {
    pending: { btn: "ordTabBtnPending", box: "admOrdersPendingContainer" },
    tracking: { btn: "ordTabBtnTracking", box: "admOrdersTrackingContainer" },
    cancel: { btn: "ordTabBtnCancel", box: "admOrdersCancelContainer" }
  };

  Object.keys(tabs).forEach(k => {
    const btnEl = document.getElementById(tabs[k].btn);
    const boxEl = document.getElementById(tabs[k].box);
    if (!btnEl || !boxEl) return;

    if (k === tabKey) {
      btnEl.className = "px-4 py-2 rounded-full font-extrabold text-xs sm:text-sm admin-pill-active text-white transition";
      boxEl.classList.remove("hidden");
    } else {
      btnEl.className = "px-4 py-2 rounded-full font-extrabold text-xs sm:text-sm text-white hover:text-amber-300 transition";
      boxEl.classList.add("hidden");
    }
  });
};

loadAdminOrdersData = async function () {
  try {
    const res = await fetch(`/api/admin/orders?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return;

    adminAllOrdersCache = data.orders || [];
    const pendingList = adminAllOrdersCache.filter(o => o.status === "pending_approval");
    const cancelList = adminAllOrdersCache.filter(o => o.status === "cancel_requested" || o.status === "cancelled_refunded");
    const trackingList = adminAllOrdersCache.filter(
      o => o.status !== "pending_approval" && o.status !== "cancel_requested"
    );

    document.getElementById("ordPendingCountText").textContent = String(pendingList.length);
    document.getElementById("ordTrackingCountText").textContent = String(trackingList.length);
    const cancelCountEl = document.getElementById("ordCancelCountText");
    if (cancelCountEl) {
      const activeCancelReqs = adminAllOrdersCache.filter(o => o.status === "cancel_requested").length;
      cancelCountEl.textContent = String(activeCancelReqs);
    }

    renderAdminPendingOrders(pendingList);
    renderAdminTrackingOrders(trackingList);
    renderAdminCancelOrders(cancelList);
    await refreshAdminNotificationsAndBadges();
  } catch (e) {
    console.warn("Error loading admin orders:", e);
  }
};

function renderAdminCancelOrders(list) {
  const container = document.getElementById("admOrdersCancelContainer");
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `<div class="bg-zinc-900 border border-white/15 rounded-3xl p-10 text-center text-gray-400 text-sm">ไม่มีคำขอยกเลิกและขอคืนเงินจากลูกค้า</div>`;
    return;
  }

  container.innerHTML = list
    .map(o => {
      const isPendingCancel = o.status === "cancel_requested";
      const itemsHtml = o.items
        .map(i => `<span class="inline-block bg-black/50 px-2.5 py-1 rounded-lg text-xs mr-2 mb-1">• ${i.title} (x${i.qty})</span>`)
        .join("");

      return `
        <div class="bg-zinc-900 border-2 ${isPendingCancel ? 'border-red-500/60' : 'border-emerald-500/40'} rounded-3xl p-6 shadow-xl space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="px-3 py-1 rounded-full ${isPendingCancel ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'} font-extrabold text-xs">
                ${isPendingCancel ? '⚠️ รอตรวจสอบการยกเลิก/คืนเงิน' : '💸 โอนเงินคืนและยกเลิกสำเร็จ'}
              </span>
              <span class="font-extrabold text-lg text-amber-400">${o.orderNumber}</span>
              <span class="text-sm font-bold text-white">ลูกค้า: ${o.customerName} (${o.customerPhone})</span>
            </div>
            <span class="text-lg font-extrabold text-emerald-400">ยอดที่ต้องคืน: ฿${Number(o.grandTotal).toLocaleString("th-TH")}</span>
          </div>

          <div>${itemsHtml}</div>

          <div class="bg-black/60 border border-white/15 rounded-2xl p-4 text-xs sm:text-sm space-y-1.5">
            <p class="text-red-300"><strong>สาเหตุที่ลูกค้าขอยกเลิก:</strong> ${o.cancelReason || "-"}</p>
            <p class="text-amber-300"><strong>ข้อมูลบัญชีรับเงินคืนของลูกค้า:</strong> ${o.refundBankInfo || "-"}</p>
          </div>

          ${
            isPendingCancel
              ? `<div class="flex flex-wrap justify-end gap-3 pt-2">
                   <button
                     onclick="updateOrderStatusByAdmin(${o.orderId}, '${o.previousStatus || 'preparing'}', false)"
                     class="px-4 py-2.5 rounded-2xl bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-xs sm:text-sm transition"
                   >
                     ปฏิเสธคำขอยกเลิก (จัดส่งต่อ)
                   </button>
                   <button
                     onclick="updateOrderStatusByAdmin(${o.orderId}, 'cancelled_refunded', false)"
                     class="px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs sm:text-sm shadow-lg transition"
                   >
                     <i class="fa-solid fa-money-bill-transfer mr-1"></i> อนุมัติยกเลิกและคืนเงินเรียบร้อย (คืนสต็อกสินค้า)
                   </button>
                 </div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

const _origUpdateOrderStatusByAdmin = updateOrderStatusByAdmin;
updateOrderStatusByAdmin = async function (orderId, nextStatus, moveToTrackingTab = false) {
  await _origUpdateOrderStatusByAdmin(orderId, nextStatus, moveToTrackingTab);
  localStorage.setItem("hb_order_realtime_sync", String(Date.now()));
  localStorage.setItem("hb_catalog_realtime_sync", String(Date.now()));
};

window.addEventListener("storage", e => {
  if (e.key === "hb_order_realtime_sync") {
    refreshAdminNotificationsAndBadges();
    const ordSec = document.getElementById("admSectionOrders");
    if (ordSec && !ordSec.classList.contains("hidden")) {
      loadAdminOrdersData();
    }
  }
});
// ============================================================================
// สเตปที่ 1 (ฉบับสมบูรณ์): ระบบคำนวณ "สรุปยอดขาย" + "การเปลี่ยนแปลงยอดขาย (%)"
//           + อัปเดตตาราง "รายงานรายละเอียดคำสั่งซื้อ" จากออเดอร์ที่จัดส่งสำเร็จ (delivered)
// ============================================================================
let realSalesFilterCategory = "all"; // 'horse' | 'other' | 'all'
let realSalesTimeframe = "daily";    // 'daily' | 'monthly' | 'yearly'
let realPieChartInstance = null;
let realLineChartInstance = null;

// แปลงวันที่จากฐานข้อมูล SQLite ให้เป็นเวลาท้องถิ่น
function parseSqliteOrderDate(dateStr) {
  if (!dateStr) return new Date();
  if (typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr.trim())) {
    return new Date(dateStr.trim().replace(" ", "T") + "Z");
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// จัดรูปแบบวัน/เดือน/ปี (พ.ศ.) และเวลา สำหรับแสดงในตารางรายงานคำสั่งซื้อ
function formatThaiOrderDateTime(dateObj) {
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = dateObj.getFullYear() + 543;
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// อัปเดตวันที่ปัจจุบันในหน้าสรุปยอดขาย (แก้ไขไม่ให้ไอคอน 📅 ซ้ำ 2 อัน)
function updateSalesHeaderCurrentDate(targetDateObj = null) {
  const d = targetDateObj || new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyyBuddhist = d.getFullYear() + 543;
  const dateText = `ข้อมูลประจำวันที่ ${dd}/${mm}/${yyyyBuddhist}`;

  const dateEl = document.getElementById("admSalesCurrentDateText");
  if (dateEl) {
    dateEl.textContent = dateText;
  } else {
    document.querySelectorAll("#admSectionSales p, #admSectionSales span, #admSectionSales div").forEach(el => {
      if (el.children.length === 0 && el.textContent.includes("ข้อมูลประจำวันที่")) {
        el.textContent = dateText;
      }
    });
  }
}

// กรองรายการสินค้าในออเดอร์ตามหมวดหมู่ที่ติ๊กเลือก (ม้า / สินค้าทั่วไป / ทั้งหมด)
function getFilteredOrderItemsRevenue(order, categoryFilter) {
  if (!order || !Array.isArray(order.items)) return [];
  return order.items.filter(item => {
    const itemType = (item.type || "other").toLowerCase();
    if (categoryFilter === "horse") return itemType === "horse";
    if (categoryFilter === "other") return itemType !== "horse";
    return true;
  });
}

// คำนวณยอดสุทธิของออเดอร์ตามหมวดหมู่ที่เลือก
function calculateOrderNetRevenue(order, filteredItems, categoryFilter) {
  const itemsSum = filteredItems.reduce((sum, it) => sum + Number(it.price || 0) * Number(it.qty || 1), 0);
  if (itemsSum <= 0) return 0;
  // หากเลือกดู "ทั้งหมด" หรือสินค้าทุกชิ้นในบิลอยู่ในหมวดเดียวกัน ให้ใช้ยอดสุทธิจริง (grandTotal) ของออเดอร์นั้น
  if (categoryFilter === "all" || (Array.isArray(order.items) && filteredItems.length === order.items.length)) {
    return Number(order.grandTotal || itemsSum);
  }
  return itemsSum;
}

// ฟังก์ชันหลักสำหรับโหลดและคำนวณยอดขายจริง + อัปเดตตารางรายงานรายละเอียดคำสั่งซื้อ
async function refreshRealAdminSalesAnalytics() {
  try {
    const res = await fetch(`/api/admin/orders?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    const allOrders = data.ok && Array.isArray(data.orders) ? data.orders : [];

    // ใช้เฉพาะคำสั่งซื้อที่สถานะเป็น "delivered" (จัดส่งสำเร็จเรียบร้อย)
    const deliveredOrders = allOrders.filter(o => o.status === "delivered");

    // กำหนดวันอ้างอิงสำหรับโหมดรายวัน (หากวันนี้ยังไม่มีออเดอร์แต่มีออเดอร์ที่จัดส่งสำเร็จในวันก่อนหน้า ให้ใช้วันล่าสุดที่มีข้อมูล)
    let refDate = new Date();
    if (deliveredOrders.length > 0) {
      const todayHasOrder = deliveredOrders.some(o => {
        const d = parseSqliteOrderDate(o.createdAt);
        return (
          d.getFullYear() === refDate.getFullYear() &&
          d.getMonth() === refDate.getMonth() &&
          d.getDate() === refDate.getDate()
        );
      });
      if (!todayHasOrder) {
        refDate = parseSqliteOrderDate(deliveredOrders[0].createdAt);
      }
    }

    updateSalesHeaderCurrentDate(refDate);

    const curYear = refDate.getFullYear();
    const curMonth = refDate.getMonth();
    const curDate = refDate.getDate();

    const productSalesMap = {};
    const matchedTableOrders = [];
    let totalPeriodRevenue = 0;

    let lineLabels = [];
    let lineValues = [];
    let currentMetricRevenue = 0;
    let previousMetricRevenue = 0;
    let comparisonLabelText = "";

    if (realSalesTimeframe === "daily") {
      lineLabels = ["06.00", "08.00", "10.00", "12.00", "14.00", "16.00", "18.00", "20.00", "22.00"];
      lineValues = new Array(lineLabels.length).fill(0);

      const yesterday = new Date(curYear, curMonth, curDate - 1);
      const yYear = yesterday.getFullYear();
      const yMonth = yesterday.getMonth();
      const yDate = yesterday.getDate();

      let latestSlotWithSale = -1;

      deliveredOrders.forEach(order => {
        const oDate = parseSqliteOrderDate(order.createdAt);
        const items = getFilteredOrderItemsRevenue(order, realSalesFilterCategory);
        const netRev = calculateOrderNetRevenue(order, items, realSalesFilterCategory);
        if (netRev <= 0) return;

        const isTargetDay =
          oDate.getFullYear() === curYear &&
          oDate.getMonth() === curMonth &&
          oDate.getDate() === curDate;

        const isPrevDay =
          oDate.getFullYear() === yYear &&
          oDate.getMonth() === yMonth &&
          oDate.getDate() === yDate;

        if (isTargetDay) {
          currentMetricRevenue += netRev;
          totalPeriodRevenue += netRev;

          items.forEach(it => {
            const key = it.title || "สินค้าทั่วไป";
            productSalesMap[key] = (productSalesMap[key] || 0) + Number(it.price || 0) * Number(it.qty || 1);
          });

          matchedTableOrders.push({
            orderNumber: order.orderNumber,
            formattedDate: formatThaiOrderDateTime(oDate),
            customerName: order.customerName || "ลูกค้าทั่วไป",
            shippingAddress: order.shippingAddress || "-",
            itemsSummary: items.map(i => `${i.title} (x${i.qty})`).join(", "),
            netPrice: netRev
          });

          const hr = oDate.getHours();
          let bucketIdx = Math.floor((hr - 6) / 2);
          if (bucketIdx < 0) bucketIdx = 0;
          if (bucketIdx >= lineValues.length) bucketIdx = lineValues.length - 1;
          lineValues[bucketIdx] += netRev;
          if (bucketIdx > latestSlotWithSale) latestSlotWithSale = bucketIdx;
        } else if (isPrevDay) {
          previousMetricRevenue += netRev;
        }
      });

      if (previousMetricRevenue > 0) {
        comparisonLabelText = `เทียบกับวันก่อนหน้า (฿${previousMetricRevenue.toLocaleString("th-TH")})`;
      } else if (latestSlotWithSale > 0 && lineValues[latestSlotWithSale - 1] > 0) {
        currentMetricRevenue = lineValues[latestSlotWithSale];
        previousMetricRevenue = lineValues[latestSlotWithSale - 1];
        comparisonLabelText = `เทียบกับช่วงเวลา ${lineLabels[latestSlotWithSale - 1]} น.`;
      } else {
        comparisonLabelText = `ยอดขายรวม ฿${currentMetricRevenue.toLocaleString("th-TH")}`;
      }
    } else if (realSalesTimeframe === "monthly") {
      lineLabels = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      lineValues = new Array(12).fill(0);

      const prevMonthDate = new Date(curYear, curMonth - 1, 1);
      const pmYear = prevMonthDate.getFullYear();
      const pmMonth = prevMonthDate.getMonth();

      deliveredOrders.forEach(order => {
        const oDate = parseSqliteOrderDate(order.createdAt);
        const items = getFilteredOrderItemsRevenue(order, realSalesFilterCategory);
        const netRev = calculateOrderNetRevenue(order, items, realSalesFilterCategory);
        if (netRev <= 0) return;

        if (oDate.getFullYear() === curYear) {
          const m = oDate.getMonth();
          lineValues[m] += netRev;
          totalPeriodRevenue += netRev;

          items.forEach(it => {
            const key = it.title || "สินค้าทั่วไป";
            productSalesMap[key] = (productSalesMap[key] || 0) + Number(it.price || 0) * Number(it.qty || 1);
          });

          matchedTableOrders.push({
            orderNumber: order.orderNumber,
            formattedDate: formatThaiOrderDateTime(oDate),
            customerName: order.customerName || "ลูกค้าทั่วไป",
            shippingAddress: order.shippingAddress || "-",
            itemsSummary: items.map(i => `${i.title} (x${i.qty})`).join(", "),
            netPrice: netRev
          });
        }

        if (oDate.getFullYear() === curYear && oDate.getMonth() === curMonth) {
          currentMetricRevenue += netRev;
        } else if (oDate.getFullYear() === pmYear && oDate.getMonth() === pmMonth) {
          previousMetricRevenue += netRev;
        }
      });

      comparisonLabelText = `เทียบเดือนนี้กับเดือนก่อนหน้า (฿${previousMetricRevenue.toLocaleString("th-TH")})`;
    } else {
      const yearsAD = [curYear - 4, curYear - 3, curYear - 2, curYear - 1, curYear];
      lineLabels = yearsAD.map(y => String(y + 543));
      lineValues = new Array(yearsAD.length).fill(0);

      deliveredOrders.forEach(order => {
        const oDate = parseSqliteOrderDate(order.createdAt);
        const items = getFilteredOrderItemsRevenue(order, realSalesFilterCategory);
        const netRev = calculateOrderNetRevenue(order, items, realSalesFilterCategory);
        if (netRev <= 0) return;

        const yIdx = yearsAD.indexOf(oDate.getFullYear());
        if (yIdx !== -1) {
          lineValues[yIdx] += netRev;
          totalPeriodRevenue += netRev;

          items.forEach(it => {
            const key = it.title || "สินค้าทั่วไป";
            productSalesMap[key] = (productSalesMap[key] || 0) + Number(it.price || 0) * Number(it.qty || 1);
          });

          matchedTableOrders.push({
            orderNumber: order.orderNumber,
            formattedDate: formatThaiOrderDateTime(oDate),
            customerName: order.customerName || "ลูกค้าทั่วไป",
            shippingAddress: order.shippingAddress || "-",
            itemsSummary: items.map(i => `${i.title} (x${i.qty})`).join(", "),
            netPrice: netRev
          });
        }

        if (oDate.getFullYear() === curYear) {
          currentMetricRevenue += netRev;
        } else if (oDate.getFullYear() === curYear - 1) {
          previousMetricRevenue += netRev;
        }
      });

      comparisonLabelText = `เทียบปีนี้กับปีก่อนหน้า (฿${previousMetricRevenue.toLocaleString("th-TH")})`;
    }

    renderRealPieChart(productSalesMap, totalPeriodRevenue);
    renderRealLineChart(lineLabels, lineValues, totalPeriodRevenue);
    renderRealPercentageChangeCard(currentMetricRevenue, previousMetricRevenue, comparisonLabelText);
    renderRealSalesReportTable(matchedTableOrders, totalPeriodRevenue, realSalesFilterCategory);
  } catch (err) {
    console.warn("Error calculating real sales analytics:", err);
  }
}

// ฟังก์ชันอัปเดตตาราง "รายงานรายละเอียดคำสั่งซื้อ" และยอด "รายได้รวมทั้งสิ้น"
function renderRealSalesReportTable(tableRowsData, totalNetRevenue, categoryFilter) {
  const tableEl = document.querySelector("#admSectionSales table");
  if (!tableEl) return;

  // 1. อัปเดตหัวตารางช่องที่ 5 ให้ตรงกับหมวดหมู่ที่เลือก (สินค้า(ม้า) / สินค้า(สินค้าทั่วไป) / สินค้า(ทั้งหมด))
  const headerCells = tableEl.querySelectorAll("th");
  headerCells.forEach(th => {
    if (th.textContent.includes("สินค้า(")) {
      th.textContent =
        categoryFilter === "horse"
          ? "สินค้า(ม้า)"
          : categoryFilter === "other"
          ? "สินค้า(สินค้าทั่วไป)"
          : "สินค้า(ทั้งหมด)";
    }
  });

  // 2. ค้นหาแถวสรุป "รายได้รวมทั้งสิ้น" ด้านล่างสุดของตาราง
  const allTrs = Array.from(tableEl.querySelectorAll("tr"));
  const headerTr = allTrs[0];
  const footerTr = allTrs.find(tr => tr.textContent.includes("รายได้รวมทั้งสิ้น"));

  if (footerTr) {
    const cells = footerTr.querySelectorAll("td, th");
    const lastCell = cells[cells.length - 1];
    if (lastCell) {
      lastCell.textContent = `฿${Number(totalNetRevenue || 0).toLocaleString("th-TH")}`;
    }
  }

  // 3. ลบเฉพาะแถวข้อมูลเก่าออก (เก็บแถวหัวตารางและแถวรายได้รวมทั้งสิ้นไว้)
  allTrs.forEach(tr => {
    if (tr !== headerTr && tr !== footerTr) {
      tr.remove();
    }
  });

  // 4. สร้างแถวรายการคำสั่งซื้อใหม่แทรกเข้าไปเหนือแถว "รายได้รวมทั้งสิ้น"
  const parentContainer = footerTr ? footerTr.parentElement : tableEl.querySelector("tbody") || tableEl;

  if (!tableRowsData || tableRowsData.length === 0) {
    const emptyTr = document.createElement("tr");
    emptyTr.innerHTML = `
      <td colspan="6" class="border border-black py-4 text-center text-xs sm:text-sm text-gray-400 font-semibold">
        ยังไม่มีรายการคำสั่งซื้อที่จัดส่งสำเร็จในหมวด/ช่วงเวลานี้
      </td>
    `;
    if (footerTr) {
      parentContainer.insertBefore(emptyTr, footerTr);
    } else {
      parentContainer.appendChild(emptyTr);
    }
    return;
  }

  tableRowsData.forEach(row => {
    const tr = document.createElement("tr");
    tr.className = "text-xs sm:text-sm text-black font-semibold hover:bg-amber-50/60 transition";
    tr.innerHTML = `
      <td class="border border-black px-3 py-2 text-center font-extrabold">${row.orderNumber}</td>
      <td class="border border-black px-3 py-2 text-center">${row.formattedDate}</td>
      <td class="border border-black px-3 py-2 text-center">${row.customerName}</td>
      <td class="border border-black px-3 py-2 text-left max-w-[240px] truncate" title="${row.shippingAddress}">${row.shippingAddress}</td>
      <td class="border border-black px-3 py-2 text-left">${row.itemsSummary}</td>
      <td class="border border-black px-3 py-2 text-right font-extrabold">฿${Number(row.netPrice).toLocaleString("th-TH")}</td>
    `;
    if (footerTr) {
      parentContainer.insertBefore(tr, footerTr);
    } else {
      parentContainer.appendChild(tr);
    }
  });
}

// วาดกราฟวงกลม (หากยังไม่มีข้อมูลยอดขาย ให้แสดงวงกลมสีเทาโล่งๆ)
function renderRealPieChart(productSalesMap, totalRevenue) {
  const canvas = document.getElementById("salesPieChart") || document.querySelector("#admSectionSales canvas:first-of-type");
  if (!canvas || typeof Chart === "undefined") return;

  const existingChart = Chart.getChart(canvas);
  if (existingChart) existingChart.destroy();

  const entries = Object.entries(productSalesMap).sort((a, b) => b[1] - a[1]);
  const hasData = totalRevenue > 0 && entries.length > 0;

  const labels = hasData ? entries.map(e => e[0]) : ["ยังไม่มีข้อมูลยอดขาย (0 ฿)"];
  const dataValues = hasData ? entries.map(e => e[1]) : [1];
  const bgColors = hasData
    ? ["#3B82F6", "#A78BFA", "#FBBF24", "#FDE047", "#10B981", "#F97316", "#EC4899"]
    : ["#E5E7EB"];

  realPieChartInstance = new Chart(canvas.getContext("2d"), {
    type: "pie",
    data: {
      labels,
      datasets: [
        {
          data: dataValues,
          backgroundColor: bgColors,
          borderColor: "#ffffff",
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#374151",
            font: { family: "Prompt, sans-serif", size: 12, weight: "600" }
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (!hasData) return " ยังไม่มีข้อมูลยอดขายที่จัดส่งสำเร็จ (0 ฿)";
              const val = Number(ctx.raw || 0);
              const pct = totalRevenue > 0 ? ((val / totalRevenue) * 100).toFixed(1) : "0.0";
              return ` ${ctx.label}: ฿${val.toLocaleString("th-TH")} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// วาดกราฟเส้นแนวโน้มรายได้ (หากยังไม่มีข้อมูล ให้แสดงเส้นตรงนิ่งๆ ที่ระดับ 0)
function renderRealLineChart(labels, values, totalRevenue) {
  const allCanvases = document.querySelectorAll("#admSectionSales canvas");
  const canvas = document.getElementById("salesLineChart") || (allCanvases.length > 1 ? allCanvases[1] : null);
  if (!canvas || typeof Chart === "undefined") return;

  const existingChart = Chart.getChart(canvas);
  if (existingChart) existingChart.destroy();

  const hasData = totalRevenue > 0;

  realLineChartInstance = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "รายได้จากการจัดส่งสำเร็จ (บาท)",
          data: values,
          borderColor: hasData ? "#3B82F6" : "#9CA3AF",
          backgroundColor: hasData ? "rgba(59, 130, 246, 0.12)" : "rgba(156, 163, 175, 0.08)",
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: hasData ? "#3B82F6" : "#9CA3AF",
          pointBorderWidth: 2,
          tension: hasData ? 0.4 : 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: hasData ? undefined : 10000,
          ticks: {
            color: "#6B7280",
            callback: v => Number(v).toLocaleString("th-TH")
          },
          grid: { color: "#E5E7EB" }
        },
        x: {
          ticks: { color: "#6B7280" },
          grid: { color: "#F3F4F6" }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` รายได้: ฿${Number(ctx.raw || 0).toLocaleString("th-TH")}`
          }
        }
      }
    }
  });
}

// คำนวณและแสดงผลการ์ด "การเปลี่ยนแปลงยอดขาย (%)"
function renderRealPercentageChangeCard(currentRev, prevRev, subtitleText) {
  let pctValue = 0;
  let sign = "";
  let colorClass = "text-gray-400";

  if (currentRev === 0 && prevRev === 0) {
    pctValue = 0;
    sign = "";
    colorClass = "text-gray-400";
  } else if (prevRev === 0 && currentRev > 0) {
    pctValue = 100;
    sign = "+";
    colorClass = "text-emerald-600";
  } else {
    pctValue = ((currentRev - prevRev) / prevRev) * 100;
    sign = pctValue > 0 ? "+" : "";
    colorClass = pctValue > 0 ? "text-emerald-600" : pctValue < 0 ? "text-red-600" : "text-gray-500";
  }

  const formattedPct = `${sign}${pctValue.toFixed(1)}%`;

  const pctEl =
    document.getElementById("admSalesPercentText") ||
    Array.from(document.querySelectorAll("#admSectionSales h3, #admSectionSales div, #admSectionSales span")).find(
      el => el.children.length === 0 && /^[+-]?\d+(\.\d+)?%$/.test(el.textContent.trim())
    );

  if (pctEl) {
    pctEl.textContent = formattedPct;
    pctEl.className = `text-4xl sm:text-5xl font-extrabold mt-2 ${colorClass}`;

    let subEl = document.getElementById("admSalesPercentSubInfo");
    if (!subEl && pctEl.parentElement) {
      subEl = document.createElement("p");
      subEl.id = "admSalesPercentSubInfo";
      subEl.className = "text-xs font-bold text-zinc-500 mt-1.5";
      pctEl.parentElement.appendChild(subEl);
    }
    if (subEl) {
      subEl.textContent =
        currentRev === 0 && prevRev === 0
          ? "ยังไม่มีคำสั่งซื้อที่จัดส่งสำเร็จ (0 ฿)"
          : `มูลค่ารอบปัจจุบัน ฿${currentRev.toLocaleString("th-TH")} • ${subtitleText}`;
    }
  }
}

// เชื่อมปุ่มสลับหมวดหมู่และปุ่มช่วงเวลา
function bindRealSalesFilterButtons() {
  const salesSec = document.getElementById("admSectionSales");
  if (!salesSec) return;

  salesSec.querySelectorAll("button").forEach(btn => {
    const txt = btn.textContent.trim();
    if (txt === "รายวัน" || txt === "รายเดือน" || txt === "รายปี") {
      btn.onclick = () => {
        realSalesTimeframe = txt === "รายวัน" ? "daily" : txt === "รายเดือน" ? "monthly" : "yearly";
        salesSec.querySelectorAll("button").forEach(b => {
          const bTxt = b.textContent.trim();
          if (bTxt === "รายวัน" || bTxt === "รายเดือน" || bTxt === "รายปี") {
            if (b === btn) {
              b.className = "px-5 py-1.5 rounded-full font-extrabold text-xs sm:text-sm admin-pill-active text-white transition";
            } else {
              b.className = "px-5 py-1.5 rounded-full font-extrabold text-xs sm:text-sm text-white hover:text-amber-300 transition";
            }
          }
        });
        refreshRealAdminSalesAnalytics();
      };
    }
  });
}

if (typeof initSalesCharts === "function") {
  initSalesCharts = function () {
    bindRealSalesFilterButtons();
    refreshRealAdminSalesAnalytics();
  };
}

if (typeof filterSalesCategory === "function") {
  const _origFilterSalesCategory = filterSalesCategory;
  filterSalesCategory = function (cat) {
    try {
      _origFilterSalesCategory(cat);
    } catch (e) {}
    realSalesFilterCategory = cat || "all";
    refreshRealAdminSalesAnalytics();
  };
}

if (typeof switchSalesPeriod === "function") {
  switchSalesPeriod = function (period) {
    realSalesTimeframe =
      period === "month" || period === "monthly"
        ? "monthly"
        : period === "year" || period === "yearly"
        ? "yearly"
        : "daily";
    refreshRealAdminSalesAnalytics();
  };
}

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    bindRealSalesFilterButtons();
    refreshRealAdminSalesAnalytics();
  }, 300);
});

window.addEventListener("storage", e => {
  if (e.key === "hb_order_realtime_sync") {
    refreshRealAdminSalesAnalytics();
  }
});
// ============================================================================
// สเตปที่ 2: ระบบแผนที่ปักหมุด "พิกัดฟาร์มตั้งต้น" และดึงชื่อ จังหวัด/อำเภอ/ตำบล อัตโนมัติ
// ============================================================================
let adminFarmLeafletMap = null;
let adminFarmLeafletMarker = null;
let adminFarmPinnedLat = 16.4419;
let adminFarmPinnedLng = 102.8360;

// แปลงพิกัดหมุดของฟาร์มเป็นชื่อ จังหวัด, เขต/อำเภอ, แขวง/ตำบล อัตโนมัติ
async function reverseGeocodeAdminFarmPin(lat, lng) {
  const nameInput = document.getElementById("setFarmName");
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1`,
      { headers: { "Accept-Language": "th,en" } }
    );
    if (!res.ok) throw new Error("Reverse geocoding failed");
    const data = await res.json();
    const addr = data.address || {};

    const province = addr.province || addr.state || addr.city || "";
    const district = addr.county || addr.city_district || addr.district || addr.municipality || "";
    const subdistrict = addr.suburb || addr.tambon || addr.village || addr.town || addr.quarter || "";
    const parts = [province, district, subdistrict].filter(Boolean);

    if (nameInput) {
      if (parts.length > 0) {
        nameInput.value = `สาขา${parts[0]} (${parts.join(", ")})`;
      } else if (data.display_name) {
        nameInput.value = data.display_name
          .split(",")
          .slice(0, 3)
          .map(s => s.trim())
          .join(", ");
      }
    }
  } catch (err) {
    console.warn("Admin farm reverse geocode error:", err);
  }
}

function updateAdminFarmPinPosition(lat, lng, shouldLookupPlace = true) {
  adminFarmPinnedLat = Number(lat);
  adminFarmPinnedLng = Number(lng);

  const latInput = document.getElementById("setFarmLat");
  const lngInput = document.getElementById("setFarmLng");
  if (latInput) latInput.value = adminFarmPinnedLat.toFixed(6);
  if (lngInput) lngInput.value = adminFarmPinnedLng.toFixed(6);

  if (adminFarmLeafletMarker) {
    adminFarmLeafletMarker.setLatLng([adminFarmPinnedLat, adminFarmPinnedLng]);
  }

  if (shouldLookupPlace) {
    reverseGeocodeAdminFarmPin(adminFarmPinnedLat, adminFarmPinnedLng);
  }
}

function initOrRefreshAdminFarmMap() {
  const mapEl = document.getElementById("adminFarmOriginMap");
  if (!mapEl || typeof L === "undefined") return;

  const latInput = document.getElementById("setFarmLat");
  const lngInput = document.getElementById("setFarmLng");
  adminFarmPinnedLat = Number(latInput?.value || 16.4419);
  adminFarmPinnedLng = Number(lngInput?.value || 102.8360);

  if (!adminFarmLeafletMap) {
    adminFarmLeafletMap = L.map("adminFarmOriginMap").setView([adminFarmPinnedLat, adminFarmPinnedLng], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap"
    }).addTo(adminFarmLeafletMap);

    adminFarmLeafletMarker = L.marker([adminFarmPinnedLat, adminFarmPinnedLng], { draggable: true }).addTo(adminFarmLeafletMap);

    adminFarmLeafletMap.on("click", e => {
      updateAdminFarmPinPosition(e.latlng.lat, e.latlng.lng, true);
    });

    adminFarmLeafletMarker.on("dragend", e => {
      const pos = e.target.getLatLng();
      updateAdminFarmPinPosition(pos.lat, pos.lng, true);
    });
  } else {
    setTimeout(() => {
      adminFarmLeafletMap.invalidateSize();
      adminFarmLeafletMap.setView([adminFarmPinnedLat, adminFarmPinnedLng], 12);
      if (adminFarmLeafletMarker) {
        adminFarmLeafletMarker.setLatLng([adminFarmPinnedLat, adminFarmPinnedLng]);
      }
    }, 100);
  }
}

// ปุ่ม "ใช้ตำแหน่งปัจจุบัน" สำหรับตั้งพิกัดฟาร์ม
function useCurrentLocationForAdminFarm() {
  if (!navigator.geolocation) {
    showAdminToast("เบราว์เซอร์ของคุณไม่รองรับการดึงพิกัด GPS");
    return;
  }
  showAdminToast("กำลังค้นหาตำแหน่งที่ตั้งปัจจุบันของฟาร์ม...");
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      updateAdminFarmPinPosition(lat, lng, false);
      if (adminFarmLeafletMap) adminFarmLeafletMap.setView([lat, lng], 14);
      await reverseGeocodeAdminFarmPin(lat, lng);
      showAdminToast("ดึงตำแหน่งปัจจุบันของฟาร์มเรียบร้อยแล้ว! กดปุ่มบันทึกการตั้งค่าด้านล่างเพื่อยืนยัน");
    },
    () => {
      showAdminToast("ไม่สามารถเข้าถึง GPS ได้ กรุณาคลิกปักหมุดบนแผนที่โดยตรง");
    }
  );
}

// เชื่อมให้แผนที่โหลดและรีเฟรชขนาดอัตโนมัติเมื่อแอดมินเปิดหน้า "ตั้งค่าพิกัดฟาร์ม & ค่าขนส่ง"
if (typeof loadAdminFarmSettings === "function") {
  const _origLoadAdminFarmSettings = loadAdminFarmSettings;
  loadAdminFarmSettings = async function () {
    await _origLoadAdminFarmSettings();
    setTimeout(initOrRefreshAdminFarmMap, 150);
  };
}
// ============================================================================
// สเตปที่ 3: ตัดช่องแสดง "รหัสผ่าน (Password)" ของผู้ใช้งานออกเพื่อความเป็นส่วนตัวของลูกค้า
// ============================================================================
renderAdminUsersList = function (users) {
  const container = document.getElementById("admUsersListContainer");
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="bg-zinc-900 border border-white/15 rounded-3xl p-8 text-center text-gray-400 text-sm">ยังไม่มีบัญชีผู้ใช้งานในระบบ</div>`;
    return;
  }

  container.innerHTML = users
    .map(
      u => `
      <div class="bg-zinc-900 border border-white/15 rounded-3xl p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 shadow-lg">
        <div class="flex items-center gap-3.5 min-w-[210px]">
          <img src="${u.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=user'}" class="w-12 h-12 rounded-full object-cover border-2 border-amber-400 bg-white shrink-0" />
          <div>
            <span class="text-[11px] font-bold text-amber-400">USER ID #${u.user_id}</span>
            <h4 class="font-extrabold text-white text-base">${u.username}</h4>
            <span class="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
              <i class="fa-solid fa-shield-halved"></i> รหัสผ่านถูกเข้ารหัสเป็นส่วนตัว
            </span>
          </div>
        </div>

        <!-- แสดงเฉพาะ Username, Gmail, และเบอร์โทรศัพท์ (ตัดช่องรหัสผ่านออกเพื่อความเป็นส่วนตัว) -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:flex-1 text-xs">
          <div>
            <label class="text-gray-400 block mb-1">Username</label>
            <input id="editUserUname_${u.user_id}" type="text" value="${u.username}" class="w-full bg-black border border-white/20 rounded-xl px-3 py-2 text-white font-semibold focus:border-amber-400 focus:outline-none" />
          </div>
          <div>
            <label class="text-gray-400 block mb-1">Gmail (1 บัญชี)</label>
            <input id="editUserEmail_${u.user_id}" type="email" value="${u.email}" class="w-full bg-black border border-white/20 rounded-xl px-3 py-2 text-white font-semibold focus:border-amber-400 focus:outline-none" />
          </div>
          <div>
            <label class="text-gray-400 block mb-1">เบอร์โทรศัพท์ (1 บัญชี)</label>
            <input id="editUserPhone_${u.user_id}" type="text" value="${u.phone}" class="w-full bg-black border border-white/20 rounded-xl px-3 py-2 text-white font-semibold focus:border-amber-400 focus:outline-none" />
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 self-end lg:self-center">
          <button
            onclick="saveUserAccountByAdmin(${u.user_id})"
            class="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition shadow"
          >
            <i class="fa-solid fa-floppy-disk mr-1"></i> บันทึกแก้ไข
          </button>
          <button
            onclick="deleteUserAccountByAdmin(${u.user_id}, '${u.username}')"
            class="px-3.5 py-2.5 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 font-bold text-xs transition"
          >
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `
    )
    .join("");
};

saveUserAccountByAdmin = async function (userId) {
  const username = document.getElementById(`editUserUname_${userId}`)?.value.trim() || "";
  const email = document.getElementById(`editUserEmail_${userId}`)?.value.trim() || "";
  const phone = document.getElementById(`editUserPhone_${userId}`)?.value.trim() || "";

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, phone, address: "" })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showAdminToast(data.message || "ไม่สามารถบันทึกข้อมูลผู้ใช้ได้");
      return;
    }
    showAdminToast(`อัปเดตข้อมูลบัญชี #${userId} เรียบร้อยแล้ว`);
    await loadAdminSupportAndUsers();
  } catch (e) {
    showAdminToast("เกิดข้อผิดพลาดในการบันทึกข้อมูลผู้ใช้");
  }
};