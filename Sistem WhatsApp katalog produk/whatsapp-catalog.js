/**
 * whatsapp-catalog.js
 * Sistem konfirmasi WhatsApp dinamis untuk halaman katalog Firebase Firestore.
 * Open-source, universal untuk semua jenis produk/jasa.
 *
 * Dependensi:
 *   - Firebase Firestore (sudah ter-import di proyek Anda)
 *   - Fungsi `db` (Firestore instance) harus tersedia secara global
 *
 * Cara pakai:
 *   1. Import / <script src="whatsapp-catalog.js">
 *   2. Panggil CatalogWA.init() setelah DOM siap
 *   3. Setiap kartu produk harus punya atribut data-product-id="<firestore_doc_id>"
 *      dan data-store-id="<firestore_store_doc_id>"
 */

const CatalogWA = (() => {

  /* ─────────────────────────────────────────────
     1. UTILITAS
  ───────────────────────────────────────────── */

  /**
   * Normalkan nomor WA ke format internasional (kode negara 62 untuk Indonesia).
   * Mendukung format: 08xx, 8xx, 628xx, +628xx
   */
  function normalizeWhatsApp(raw = '') {
    let num = raw.toString().trim().replace(/[\s\-().+]/g, '');
    if (num.startsWith('0')) {
      num = '62' + num.slice(1);
    } else if (num.startsWith('8')) {
      num = '62' + num;
    } else if (num.startsWith('+62')) {
      num = num.slice(1);
    }
    return num;
  }

  /**
   * Format angka ke Rupiah, mis. 25000 → "Rp 25.000"
   */
  function formatRupiah(amount) {
    const number = parseFloat(amount);
    if (isNaN(number)) return amount;
    return 'Rp ' + number.toLocaleString('id-ID');
  }

  /**
   * Buat teks pesan WhatsApp sesuai spesifikasi.
   */
  function buildWhatsAppMessage({ namaPembeli, namaProduk, harga, catatan }) {
    const hargaFormatted = formatRupiah(harga);
    const catatanText = catatan && catatan.trim() ? catatan.trim() : '-';

    return (
      `Halo, saya *${namaPembeli}* ingin konfirmasi pembayaran untuk pesanan:\n` +
      `- Produk: *${namaProduk}*\n` +
      `- Total: *${hargaFormatted}*\n` +
      `- Catatan: ${catatanText}\n\n` +
      `Berikut saya lampirkan foto bukti transfer / struk pembayaran QRIS saya. ` +
      `Mohon segera diproses ya, terima kasih.`
    );
  }

  /**
   * Buka URL WhatsApp di tab baru.
   */
  function openWhatsApp(nomorWA, pesan) {
    const nomor = normalizeWhatsApp(nomorWA);
    const encoded = encodeURIComponent(pesan);
    const url = `https://wa.me/${nomor}?text=${encoded}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ─────────────────────────────────────────────
     2. FETCH DATA FIRESTORE
  ───────────────────────────────────────────── */

  /**
   * Ambil data produk dari Firestore.
   * @param {string} storeId  - ID dokumen toko (koleksi "stores" atau sesuai struktur Anda)
   * @param {string} productId - ID dokumen produk
   * @returns {Promise<{product, store}>}
   */
  async function fetchProductAndStore(storeId, productId) {
    const { doc, getDoc } = window.FirestoreSDK;

    const [productSnap, storeSnap] = await Promise.all([
      getDoc(doc(db, 'stores', storeId, 'products', productId)),
      getDoc(doc(db, 'stores', storeId)),
    ]);

    if (!productSnap.exists()) throw new Error('Produk tidak ditemukan.');
    if (!storeSnap.exists()) throw new Error('Data toko tidak ditemukan.');

    return {
      product: { id: productSnap.id, ...productSnap.data() },
      store: { id: storeSnap.id, ...storeSnap.data() },
    };
  }

  /* ─────────────────────────────────────────────
     3. MODAL — RENDER & LIFECYCLE
  ───────────────────────────────────────────── */

  const MODAL_ID = 'wa-catalog-modal';

  function getModalHTML() {
    return `
<div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="wa-modal-title"
  style="display:none; position:fixed; inset:0; z-index:9999;
         background:rgba(0,0,0,0.55); align-items:center; justify-content:center; padding:1rem;">
  <div style="background:#fff; border-radius:16px; width:100%; max-width:480px;
              max-height:90vh; overflow-y:auto; padding:1.5rem; position:relative;
              font-family:sans-serif;">

    <!-- Tombol tutup -->
    <button id="wa-modal-close" aria-label="Tutup modal"
      style="position:absolute; top:1rem; right:1rem; background:none; border:none;
             font-size:1.4rem; cursor:pointer; color:#666; line-height:1;">&#x2715;</button>

    <!-- Header produk -->
    <h2 id="wa-modal-title"
      style="margin:0 2rem 0.25rem 0; font-size:1.1rem; font-weight:600; color:#111;"></h2>
    <p id="wa-modal-price"
      style="margin:0 0 1rem; font-size:1.25rem; font-weight:700; color:#1a7f4b;"></p>

    <!-- Gambar QRIS/metode bayar -->
    <div id="wa-modal-qris-wrap" style="display:none; margin-bottom:1rem; text-align:center;">
      <p style="font-size:0.8rem; color:#666; margin:0 0 0.4rem;">Scan QRIS / Metode Pembayaran:</p>
      <img id="wa-modal-qris" alt="QRIS toko"
        style="max-width:200px; width:100%; border-radius:8px;
               border:1px solid #e0e0e0; object-fit:contain;" />
    </div>

    <!-- Formulir pembeli -->
    <div style="display:flex; flex-direction:column; gap:0.75rem;">
      <div>
        <label for="wa-input-name"
          style="display:block; font-size:0.82rem; color:#444; margin-bottom:4px;">
          Nama Pembeli / Pelanggan <span style="color:#c00;">*</span>
        </label>
        <input id="wa-input-name" type="text" placeholder="Contoh: Budi Santoso"
          style="width:100%; box-sizing:border-box; padding:0.6rem 0.75rem;
                 border:1px solid #ccc; border-radius:8px; font-size:0.95rem;" />
      </div>
      <div>
        <label for="wa-input-note"
          style="display:block; font-size:0.82rem; color:#444; margin-bottom:4px;">
          Catatan Tambahan
          <span style="color:#999;">(No. meja, kamar, ukuran, dll.)</span>
        </label>
        <textarea id="wa-input-note" rows="3"
          placeholder="Contoh: Meja 7 / Kamar 203 / Ukuran L"
          style="width:100%; box-sizing:border-box; padding:0.6rem 0.75rem;
                 border:1px solid #ccc; border-radius:8px; font-size:0.95rem;
                 resize:vertical;"></textarea>
      </div>
    </div>

    <!-- Pesan error -->
    <p id="wa-modal-error"
      style="display:none; color:#c00; font-size:0.82rem; margin:0.5rem 0 0;"></p>

    <!-- Tombol kirim WA -->
    <button id="wa-btn-confirm"
      style="margin-top:1.25rem; width:100%; padding:0.75rem; border-radius:10px;
             background:#25d366; color:#fff; font-weight:700; font-size:1rem;
             border:none; cursor:pointer; display:flex; align-items:center;
             justify-content:center; gap:0.5rem;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15
                 -.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075
                 -.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059
                 -.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52
                 .149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52
                 -.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51
                 -.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372
                 -.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074
                 .149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625
                 .712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413
                 .248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.555 4.116 1.528 5.845L.057 23.5
                 a.5.5 0 0 0 .61.61l5.701-1.467A11.95 11.95 0 0 0 12 24c6.627 0 12-5.373
                 12-12S18.627 0 12 0zm0 21.9a9.89 9.89 0 0 1-5.03-1.372l-.36-.214
                 -3.742.962.989-3.65-.233-.374A9.86 9.86 0 0 1 2.1 12C2.1 6.533
                 6.533 2.1 12 2.1S21.9 6.533 21.9 12 17.467 21.9 12 21.9z"/>
      </svg>
      Konfirmasi via WhatsApp
    </button>

    <p id="wa-modal-loading"
      style="display:none; text-align:center; color:#888; font-size:0.85rem; margin-top:0.75rem;">
      Memuat data produk...
    </p>
  </div>
</div>`;
  }

  function injectModal() {
    if (document.getElementById(MODAL_ID)) return;
    document.body.insertAdjacentHTML('beforeend', getModalHTML());
  }

  function showModal() {
    const modal = document.getElementById(MODAL_ID);
    modal.style.display = 'flex';
    document.getElementById('wa-input-name').value = '';
    document.getElementById('wa-input-note').value = '';
    hideError();
    document.getElementById('wa-input-name').focus();
  }

  function hideModal() {
    document.getElementById(MODAL_ID).style.display = 'none';
  }

  function showError(msg) {
    const el = document.getElementById('wa-modal-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideError() {
    document.getElementById('wa-modal-error').style.display = 'none';
  }

  function setLoading(isLoading) {
    document.getElementById('wa-modal-loading').style.display = isLoading ? 'block' : 'none';
    document.getElementById('wa-btn-confirm').disabled = isLoading;
  }

  /**
   * Isi modal dengan data produk & toko dari Firestore.
   * @param {{product, store}} data
   */
  function populateModal({ product, store }) {
    document.getElementById('wa-modal-title').textContent =
      product.nama_produk || product.name || 'Nama Produk';

    document.getElementById('wa-modal-price').textContent =
      formatRupiah(product.harga || product.price || 0);

    const qrisWrap = document.getElementById('wa-modal-qris-wrap');
    const qrisImg = document.getElementById('wa-modal-qris');
    const qrisUrl = store.qris_image || store.payment_image || null;

    if (qrisUrl) {
      qrisImg.src = qrisUrl;
      qrisWrap.style.display = 'block';
    } else {
      qrisWrap.style.display = 'none';
    }

    // Simpan data penting ke atribut modal agar bisa diakses tombol konfirmasi
    const modal = document.getElementById(MODAL_ID);
    modal.dataset.waOwner     = store.whatsapp_owner || store.wa_owner || '';
    modal.dataset.namaProduk  = product.nama_produk  || product.name  || '';
    modal.dataset.harga       = product.harga        || product.price || '0';
  }

  /* ─────────────────────────────────────────────
     4. EVENT HANDLERS
  ───────────────────────────────────────────── */

  /**
   * Klik kartu produk → fetch Firestore → tampilkan modal
   */
  async function onProductCardClick(event) {
    const card = event.currentTarget;
    const productId = card.dataset.productId;
    const storeId   = card.dataset.storeId;

    if (!productId || !storeId) {
      console.warn('CatalogWA: kartu produk tidak punya data-product-id atau data-store-id');
      return;
    }

    showModal();
    setLoading(true);

    try {
      const data = await fetchProductAndStore(storeId, productId);
      populateModal(data);
    } catch (err) {
      console.error('CatalogWA fetchError:', err);
      showError('Gagal memuat data produk. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Klik tombol "Konfirmasi via WhatsApp"
   */
  function onConfirmClick() {
    hideError();

    const modal       = document.getElementById(MODAL_ID);
    const namaPembeli = document.getElementById('wa-input-name').value.trim();
    const catatan     = document.getElementById('wa-input-note').value.trim();
    const waOwner     = modal.dataset.waOwner;
    const namaProduk  = modal.dataset.namaProduk;
    const harga       = modal.dataset.harga;

    if (!namaPembeli) {
      showError('Nama pembeli wajib diisi.');
      document.getElementById('wa-input-name').focus();
      return;
    }

    if (!waOwner) {
      showError('Nomor WhatsApp toko belum dikonfigurasi oleh admin.');
      return;
    }

    const pesan = buildWhatsAppMessage({ namaPembeli, namaProduk, harga, catatan });
    openWhatsApp(waOwner, pesan);
  }

  /* ─────────────────────────────────────────────
     5. INISIALISASI
  ───────────────────────────────────────────── */

  /**
   * Daftarkan event listener ke semua kartu produk.
   * Panggil ulang jika kartu produk di-render secara dinamis (misal pagination).
   */
  function bindProductCards() {
    const cards = document.querySelectorAll('[data-product-id][data-store-id]');
    cards.forEach((card) => {
      card.removeEventListener('click', onProductCardClick); // cegah duplikasi
      card.addEventListener('click', onProductCardClick);
      card.style.cursor = 'pointer';
    });
    return cards.length;
  }

  /**
   * Inisialisasi utama. Panggil sekali setelah DOM dan Firebase siap.
   *
   * @param {object} options
   * @param {object} options.firestoreSDK  - Objek berisi { doc, getDoc } dari firebase/firestore
   * @param {object} options.firestoreDb   - Instance `db` dari getFirestore()
   *
   * Contoh:
   *   import { doc, getDoc } from 'firebase/firestore';
   *   CatalogWA.init({ firestoreSDK: { doc, getDoc }, firestoreDb: db });
   */
  function init({ firestoreSDK, firestoreDb } = {}) {
    if (firestoreSDK) window.FirestoreSDK = firestoreSDK;
    if (firestoreDb)  window.db           = firestoreDb;

    injectModal();

    document.getElementById('wa-modal-close').addEventListener('click', hideModal);
    document.getElementById('wa-btn-confirm').addEventListener('click', onConfirmClick);

    // Tutup modal jika klik di luar konten
    document.getElementById(MODAL_ID).addEventListener('click', (e) => {
      if (e.target.id === MODAL_ID) hideModal();
    });

    // Tutup modal dengan tombol Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideModal();
    });

    const bound = bindProductCards();
    console.log(`CatalogWA: siap — ${bound} kartu produk terdaftar.`);
  }

  /* ─────────────────────────────────────────────
     6. PUBLIC API
  ───────────────────────────────────────────── */
  return {
    init,
    bindProductCards,     // panggil ulang setelah render dinamis
    normalizeWhatsApp,    // utilitas bisa dipakai di luar modul
    formatRupiah,
  };

})();


/* ─────────────────────────────────────────────
   CONTOH INTEGRASI (hapus blok ini di produksi)
   ─────────────────────────────────────────────
   import { initializeApp } from 'firebase/app';
   import { getFirestore, doc, getDoc } from 'firebase/firestore';

   const app = initializeApp(firebaseConfig);
   const db  = getFirestore(app);

   document.addEventListener('DOMContentLoaded', () => {
     CatalogWA.init({
       firestoreSDK: { doc, getDoc },
       firestoreDb: db,
     });
   });

   // Jika produk di-render ulang secara dinamis (infinite scroll, filter, dll):
   // CatalogWA.bindProductCards();

   // Contoh HTML kartu produk:
   // <div class="product-card"
   //      data-product-id="abc123"
   //      data-store-id="toko-xyz">
   //   <img src="..." alt="Nama Produk" />
   //   <h3>Nama Produk</h3>
   //   <p>Rp 25.000</p>
   // </div>

   // Struktur dokumen Firestore yang diharapkan:
   // stores/{storeId}
   //   ├── whatsapp_owner: "081234567890"  ← nomor WA admin
   //   ├── qris_image: "https://..."       ← URL gambar QRIS (opsional)
   //   └── products/{productId}
   //         ├── nama_produk: "Es Teh Manis"
   //         └── harga: 5000
─────────────────────────────────────────────── */
