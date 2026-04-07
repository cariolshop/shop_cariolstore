// =================================================================================
// Konfigurasi Worker
// Ubah pengaturan di bawah ini untuk mengelola cache dan mode debug.
// =================================================================================
const config = {
  // Set ke `true` untuk menonaktifkan cache (berguna saat development)
  // Set ke `false` untuk mengaktifkan cache di production
  DEBUG_CACHE: false,
  // Pengaturan Cache Time-to-Live (TTL) dalam detik
  CACHE_TTL: {
    HOMEPAGE: 86400, // TTL untuk halaman utama (1 hari)
    RSS_FEED: 86400, // TTL untuk RSS feed dan Sitemap (1 hari)
    PRODUCT_ITEM: 2629800, // TTL untuk halaman detail produk (1 bulan)
    FAVICON: 31536000, // TTL untuk favicon (1 tahun)
    DEFAULT: 86400, // TTL default untuk aset lain
  },
};
const SITE_NAME = 'Cariolstore';
// =================================================================================
// Event Listener Utama
// =================================================================================
export default {
  async fetch(request, env, ctx) {
    // Abaikan cache jika mode debug aktif
    if (config.DEBUG_CACHE) {
      return await handleRequest(request);
    }
    const cache = caches.default;
    // Normalisasi cache key ke GET untuk mendukung HEAD requests
    let cacheKey = new Request(request.url, { method: 'GET' });
    let response = await cache.match(cacheKey);
    if (!response) {
      // Selalu jalankan handleRequest sebagai GET
      response = await handleRequest(new Request(request.url, { method: 'GET' }));
      // Hanya cache jika request asli adalah GET dan response valid
      if (request.method === 'GET' && response.ok) {
        const responseToCache = response.clone();
        ctx.waitUntil(cache.put(cacheKey, responseToCache));
      }
    }
    // Jika request adalah HEAD, kembalikan response tanpa body
    if (request.method === 'HEAD') {
      response = new Response(null, {
        status: response.status,
        headers: response.headers,
      });
    }
    return response;
  },
};
// =================================================================================
// Fungsi Utama untuk Menangani Permintaan
// =================================================================================
async function handleRequest(request) {
  const { pathname } = new URL(request.url);
  const { hostname } = new URL(request.url);
  const currentDomain = `https://${hostname}`;
  try {
    if (pathname === '/favicon.ico') {
      return await handleFavicon();
    }
    if (pathname === '/feed.xml') {
      return await handleRSSFeed(currentDomain);
    }
    // BARU: Menambahkan route untuk sitemap.xml
    if (pathname === '/sitemap.xml') {
        return await handleSitemap(currentDomain);
    }
    if (pathname === '/ads.txt') {
      return await handleAds();
    }
    if (pathname === '/robots.txt') {
      // MODIFIKASI: Mengirimkan currentDomain ke handleRobots
      return await handleRobots(currentDomain);
    }
    if (pathname.startsWith('/produk/')) {
      return await handleProductItem(pathname, currentDomain);
    }
    if (pathname === '/') {
      return await handleHomepage(currentDomain);
    }
    // Untuk semua path lain, lakukan redirect
    return handleOtherPaths(request);
  } catch (error) {
    console.error('Worker Error:', error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}
// =================================================================================
// Handler untuk Setiap Route
// =================================================================================
/**
 * Mengambil dan menyajikan favicon dari sumber eksternal.
 */
async function handleFavicon() {
  const faviconURL = 'https://cariolshop.github.io/favicon.ico';
  const response = await fetch(faviconURL, {
    cf: {
      cacheTtl: config.CACHE_TTL.FAVICON,
      cacheEverything: true,
    },
  });
  // Buat header baru untuk memastikan kontrol cache yang tepat
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${config.CACHE_TTL.FAVICON}`);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
/**
 * Membuat RSS feed dari data produk yang diambil dari API.
 */
async function handleRSSFeed(currentDomain) {
  const data = await fetchProductData();
  const feed = createRSSFeed(data, currentDomain);
  return new Response(feed, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.RSS_FEED}`,
    },
  });
}
/**
 * BARU: Membuat sitemap dari data produk yang diambil dari API.
 */
async function handleSitemap(currentDomain) {
    const data = await fetchProductData();
    const sitemap = createSitemap(data, currentDomain);
    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': `public, max-age=${config.CACHE_TTL.RSS_FEED}`, // Menggunakan TTL yang sama dengan RSS
      },
    });
}
/**
 * Menangani permintaan untuk ads.txt.
 */
async function handleAds() {
  const adsTxtContent = 'google.com, pub-8469029934963239, DIRECT, f08c47fec0942fa0';
  return new Response(adsTxtContent, {
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.FAVICON}`,
    },
  });
}
/**
 * MODIFIKASI: Menangani permintaan untuk robots.txt secara dinamis.
 */
async function handleRobots(currentDomain) {
  // MODIFIKASI: Sitemap sekarang mengarah ke sitemap.xml dengan domain dinamis
  const robotsTxtContent = `User-agent: *
Allow: /
Sitemap: ${currentDomain}/sitemap.xml`;
  return new Response(robotsTxtContent, {
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.FAVICON}`,
    },
  });
}
/**
 * Menangani permintaan untuk halaman detail produk.
 * Fetch data dari API, lalu generate HTML dengan countdown redirect.
 */
async function handleProductItem(pathname, currentDomain) {
  const [, , shopid, itemid] = pathname.split('/');
  if (!shopid || !itemid) {
    return new Response('URL item tidak valid', { status: 400 });
  }
  // Fetch data produk dari API
  const apiUrl = `https://shp-apis.cariolshop.qzz.io/produk/${itemid}/${shopid}`;
  let productData;
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'CloudflareWorker/1.0',
        'Accept': 'application/json',
      },
      cf: {
        cacheTtl: config.CACHE_TTL.PRODUCT_ITEM,
        cacheEverything: true,
      },
    });
    if (!response.ok) {
      throw new Error(`API merespons dengan status: ${response.status}`);
    }
    const json = await response.json();
    if (!json.success || !json.data) {
      throw new Error('Format respons API tidak valid.');
    }
    productData = json.data;
  } catch (error) {
    console.error('Product API Error:', error);
    return new Response(createFallbackHTML(error.message), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }
  // Generate HTML untuk halaman produk
  const html = createProductHTML(productData, currentDomain, shopid, itemid);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.PRODUCT_ITEM}`,
      'X-Robots-Tag': 'index, follow',
    },
  });
}
/**
 * Membuat halaman utama dengan daftar produk dari API.
 */
async function handleHomepage(currentDomain) {
  try {
    const data = await fetchProductData();
    const html = createHomepageHTML(data, currentDomain);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': `public, max-age=${config.CACHE_TTL.HOMEPAGE}`,
      },
    });
  } catch (error) {
    console.error('Homepage Error:', error);
    const fallbackHTML = createFallbackHTML(error.message);
    return new Response(fallbackHTML, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }
}
/**
 * Melakukan redirect untuk semua path yang tidak cocok ke Shopee dengan parameter afiliasi.
 */
function handleOtherPaths(request) {
  const url = new URL(request.url);
  const destinationURL = `https://shopee.co.id${url.pathname}${url.search}?utm_source=an_11367000189&utm_medium=affiliates&utm_campaign=-&utm_content=cariolstore----&af_siteid=an_11367000189&pid=affiliates&af_click_lookback=7d&af_viewthrough_lookback=1d&is_retargeting=true&af_reengagement_window=7d&af_sub_siteid=cariolstore----&c=-&deep_and_deferred=1`;
  return Response.redirect(destinationURL, 302);
}
// =================================================================================
// Fungsi Pembantu (Helpers)
// =================================================================================
/**
 * Mengambil dan mem-parsing data produk dari API eksternal.
 */
async function fetchProductData() {
  const apiUrl = 'https://shp-apis.cariolshop.qzz.io/produks';
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'CloudflareWorker/1.0',
      'Accept': 'application/json',
    },
    cf: {
      cacheTtl: config.CACHE_TTL.DEFAULT,
      cacheEverything: true,
    },
  });
  if (!response.ok) {
    throw new Error(`API merespons dengan status: ${response.status}`);
  }
  const json = await response.json();
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error('Format respons API tidak valid atau tidak ada data.');
  }
  return json.data;
}
/**
 * Membersihkan nama produk dari entitas HTML yang mungkin ada.
 */
function sanitizeProductName(name) {
  if (typeof name !== 'string') return 'Produk Tanpa Nama';
  return name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
/**
 * Mengganti karakter khusus untuk digunakan di dalam XML.
 */
function escapeXML(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/**
 * Mengganti karakter khusus untuk digunakan di dalam atribut HTML.
 */
function escapeHTML(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/**
 * Membersihkan deskripsi produk dari garis bawah berlebih yang bisa merusak UI.
 */
function cleanDescription(description) {
  if (typeof description !== 'string') return 'Tidak ada deskripsi.';
  // Hapus garis bawah berulang seperti ___________________________________________
  return description.replace(/_{10,}/g, ''); // Hapus garis bawah lebih dari 10 karakter berturut-turut
}
// =================================================================================
// Fungsi untuk Membuat Konten (RSS, Sitemap, HTML)
// =================================================================================
/**
 * Membuat konten RSS Feed dari data produk.
 */
function createRSSFeed(data, currentDomain) {
  const items = data
    .map((item) => {
      if (!item.name || !item.shopid || !item.itemid) return '';
      const safeName = escapeXML(sanitizeProductName(item.name));
      const link = `${currentDomain}/produk/${item.shopid}/${item.itemid}`;
      const image = `https://i0.wp.com/cf.shopee.com/${item.image}_tn`;
      return `
      <item>
        <title><![CDATA[${safeName}]]></title>
        <link>${link}</link>
        <guid isPermaLink="true">${link}</guid>
        <pubDate>${new Date().toUTCString()}</pubDate>
        <description><![CDATA[<img src="${image}" alt="${safeName}" /> <br/> ${safeName}]]></description>
        <enclosure url="${image}" type="image/jpeg" length="0"/>
      </item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Feed ${SITE_NAME}</title>
    <link>${currentDomain}</link>
    <description>Update produk terbaru dari ${SITE_NAME}.</description>
    <atom:link href="${currentDomain}/feed.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}
/**
 * BARU: Membuat konten Sitemap XML dari data produk.
 */
function createSitemap(data, currentDomain) {
    const today = new Date().toISOString();
 
    // URL untuk halaman utama (root domain)
    const homeUrl = `
    <url>
      <loc>${currentDomain}/</loc>
      <lastmod>${today}</lastmod>
      <changefreq>daily</changefreq>
      <priority>1.0</priority>
    </url>`;
 
    // URL untuk setiap produk
    const productUrls = data
      .map((item) => {
        if (!item.shopid || !item.itemid) return '';
        const link = `${currentDomain}/produk/${item.shopid}/${item.itemid}`;
        return `
    <url>
      <loc>${escapeXML(link)}</loc>
      <lastmod>${today}</lastmod>
      <changefreq>daily</changefreq>
      <priority>0.8</priority>
    </url>`;
      })
      .join('');
 
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${homeUrl}
  ${productUrls}
</urlset>`;
  }
/**
 * Membuat daftar item produk dalam format HTML untuk homepage.
 */
function createHomepageItemsHTML(data, currentDomain) {
  const itemsToDisplay = Array.isArray(data) ? data.slice(0, 100) : [];
  return itemsToDisplay.map((item) => {
    if (!item.name || !item.shopid || !item.itemid) {
      return '';
    }
    const safeName = escapeHTML(sanitizeProductName(item.name));
    const safeImage = `https://i0.wp.com/cf.shopee.com/${item.image}_tn`;
    const itemUrl = `${currentDomain}/produk/${item.shopid}/${item.itemid}`;
    return `
      <div class="product-card">
        <a href="${itemUrl}" title="${safeName}" class="product-link">
          <div class="product-image-container">
            <img src="${safeImage}" alt="${safeName}" class="product-image" loading="lazy">
          </div>
          <div class="product-info">
            <h3 class="product-title">${safeName}</h3>
            <div class="product-action">
              <span class="product-price-label">Lihat Detail</span>
              <span class="product-arrow">&#10140;</span>
            </div>
          </div>
        </a>
      </div>`;
  }).join('');
}
/**
 * Membuat konten produk detail dalam format HTML.
 */
function createProductDetailHTML(productData) {
  const safeName = escapeHTML(sanitizeProductName(productData.name || 'Produk Tanpa Nama'));
  const cleanedDescription = cleanDescription(productData.description || 'Tidak ada deskripsi.');
  const safeDescription = escapeHTML(cleanedDescription);
  const images = productData.images ? productData.images.split(',').filter(img => img.trim()) : [productData.image];
  const mainImage = `https://i0.wp.com/cf.shopee.com/${productData.image || 'default'}_tn`;
  // Buat gallery sederhana
  const imagesHTML = images.map(img => {
    const safeImg = `https://i0.wp.com/cf.shopee.com/${img.trim()}_tn`;
    return `<img src="${safeImg}" alt="${safeName}" class="gallery-image" loading="lazy">`;
  }).join('');
  return `
    <section class="product-detail-section">
      <div class="container">
        <div class="product-detail">
          <div class="product-gallery">
            <img src="${mainImage}" alt="${safeName}" class="main-image">
            <div class="thumbnail-gallery">${imagesHTML}</div>
          </div>
          <div class="product-info">
            <h1 class="product-detail-title">${safeName}</h1>
            <p class="product-description">${safeDescription.replace(/\n/g, '<br>')}</p>
          </div>
        </div>
        <div id="redirect-timer" class="redirect-timer">
          Anda akan diarahkan ke halaman pembelian dalam <span id="countdown">10</span> detik...
        </div>
      </div>
    </section>`;
}
// =================================================================================
// Modular HTML Components
// =================================================================================
/**
 * Modular: Header HTML
 */
function createHeaderHTML(currentDomain) {
  return `
    <header class="header">
      <div class="container">
        <nav class="navbar">
          <a href="/" class="logo">${SITE_NAME} <span>shop</span></a>
          <div class="nav-links">
            <a href="/">Home</a>
            <a href="#">Kategori</a>
            <a href="#">Tentang Kami</a>
          </div>
        </nav>
      </div>
    </header>`;
}
/**
 * Modular: Search Section HTML
 */
function createSearchSectionHTML() {
  return `
    <section class="search-section">
      <div class="container">
        <script async src="https://cse.google.com/cse.js?cx=a4ed67d1e0ab41245"></script>
        <div class="gcse-search"></div>
      </div>
    </section>`;
}
/**
 * Modular: Footer HTML
 */
function createFooterHTML(currentDomain) {
  return `
    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <div class="footer-about">
            <a href="/" class="logo">Cariolshop</a>
            <p>Platform belanja online terlengkap yang menghadirkan jutaan produk berkualitas dengan harga terbaik. Belanja mudah, aman, dan nyaman.</p>
          </div>
          <div class="footer-links">
            <h4>Kategori Populer</h4>
            <ul>
              <li><a href="/?q=elektronik">Elektronik</a></li>
              <li><a href="/?q=fashion">Fashion Pria & Wanita</a></li>
              <li><a href="/?q=gadget">Gadget & Aksesoris</a></li>
              <li><a href="/?q=sepatu">Sepatu & Sandal</a></li>
              <li><a href="/?q=perabotan">Perabotan Rumah</a></li>
            </ul>
          </div>
          <div class="footer-links">
            <h4>Informasi</h4>
            <ul>
              <li><a href="/">Beranda</a></li>
              <li><a href="#">Kebijakan Privasi</a></li>
              <li><a href="#">Syarat & Ketentuan</a></li>
              <li><a href="#">Hubungi Kami</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>&copy; ${new Date().getFullYear()} <a href="/">${SITE_NAME}</a>. All Rights Reserved.</p>
        </div>
      </div>
    </footer>`;
}
/**
 * Modular: Back to Top Button and Script
 */
function createBackToTopHTML() {
  return `
    <button id="backToTop" title="Kembali ke atas">&#8679;</button>
    <script>
      // Script untuk tombol "Back to Top"
      const backToTopBtn = document.getElementById('backToTop');
      window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
          backToTopBtn.classList.add('visible');
        } else {
          backToTopBtn.classList.remove('visible');
        }
      }, { passive: true });
     
      backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    </script>`;
}
/**
 * Modular: Google Adsense Script
 */
function createAdsenseScript() {
  return `
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8469029934963239"
     crossorigin="anonymous"></script>`;
}
/**
 * Modular: Google Analytics Script
 */
function createGoogleAnalytics() {
  return `
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-8RVGX1JFDH"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-8RVGX1JFDH');
    </script>`;
}
/**
 * Modular: CSS Styles (dibuat lebih modular dengan sections terpisah)
 */
function createCSSStyles() {
  return `
    /* CSS Variables untuk tema warna */ :root { --sea-blue: #006994; --dark-blue: #003d5b; --black: #1a1a1a; --white: #ffffff; --gray-bg: #f8f9fa; --gray-border: #dee2e6; --text-color: #333; --text-light: #6c757d; --header-height: 70px; --border-radius: 8px; --shadow: 0 4px 15px rgba(0, 0, 0, 0.07); }
    /* Reset dan Global Styles */ *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; } html { scroll-behavior: smooth; } body { font-family: 'Poppins', sans-serif; background-color: var(--white); color: var(--text-color); line-height: 1.6; font-size: 16px; } img { max-width: 100%; height: auto; display: block; } a { text-decoration: none; color: var(--sea-blue); transition: color 0.3s ease; } a:hover { color: var(--dark-blue); } .container { max-width: 1280px; margin: 0 auto; padding: 0 20px; }
    /* Header & Navbar */ .header { background-color: rgba(255, 255, 255, 0.95); border-bottom: 1px solid var(--gray-border); position: sticky; top: 0; z-index: 1000; backdrop-filter: blur(8px); height: var(--header-height); display: flex; align-items: center; } .navbar { display: flex; justify-content: space-between; align-items: center; width: 100%; } .logo { font-size: 1.75rem; font-weight: 700; color: var(--black); } .logo span { color: var(--sea-blue); } .nav-links a { color: var(--text-color); font-weight: 600; margin-left: 25px; } .nav-links a:hover { color: var(--sea-blue); }
    /* Hero Section */ .hero { background-color: var(--gray-bg); padding: 80px 0; text-align: center; } .hero-title { font-size: 3.5rem; font-weight: 700; color: var(--black); margin-bottom: 1rem; line-height: 1.2; } .hero-subtitle { font-size: 1.25rem; color: var(--text-light); max-width: 700px; margin: 0 auto 2rem; }
    /* Search Section */ .search-section { padding: 40px 0; background-color: var(--white); } .gcse-search { max-width: 800px; margin: 0 auto; }
    /* Products Section (Homepage) */ .products-section { padding: 60px 0; background-color: var(--gray-bg); } .section-header { text-align: center; margin-bottom: 50px; } .section-title { font-size: 2.5rem; font-weight: 700; margin-bottom: 10px; color: var(--black); } .section-subtitle { color: var(--text-light); max-width: 600px; margin: 0 auto; }
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 25px; } .product-card { background-color: var(--white); border-radius: var(--border-radius); box-shadow: var(--shadow); overflow: hidden; transition: transform 0.3s ease, box-shadow 0.3s ease; display: flex; flex-direction: column; } .product-card:hover { transform: translateY(-8px); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1); } .product-image-container { aspect-ratio: 1 / 1; background-color: #fff; padding: 1rem; border-bottom: 1px solid var(--gray-border); } .product-image { width: 100%; height: 100%; object-fit: contain; } .product-info { padding: 1rem; display: flex; flex-direction: column; flex-grow: 1; } .product-title { font-size: 1rem; font-weight: 600; line-height: 1.4; color: var(--text-color); margin-bottom: 0.75rem; flex-grow: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } .product-action { display: flex; justify-content: space-between; align-items: center; margin-top: auto; } .product-price-label { font-size: 1rem; font-weight: 700; color: var(--sea-blue); } .product-arrow { font-size: 1.25rem; color: var(--sea-blue); transition: transform 0.3s ease; } .product-card:hover .product-arrow { transform: translateX(5px); }
    /* Product Detail Section */ .product-detail-section { padding: 60px 0; background-color: var(--gray-bg); } .product-detail { display: flex; gap: 40px; max-width: 900px; margin: 0 auto; } .product-gallery { flex: 1; display: flex; flex-direction: column; gap: 20px; } .main-image { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background-color: #fff; border-radius: var(--border-radius); box-shadow: var(--shadow); } .thumbnail-gallery { display: flex; gap: 10px; overflow-x: auto; } .gallery-image { width: 80px; height: 80px; object-fit: contain; border-radius: var(--border-radius); border: 1px solid var(--gray-border); cursor: pointer; transition: border-color 0.3s; } .gallery-image:hover { border-color: var(--sea-blue); } .product-info { flex: 1; } .product-detail-title { font-size: 2rem; font-weight: 700; color: var(--black); margin-bottom: 20px; white-space: normal; word-break: break-word; } .product-description { color: var(--text-color); white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; } .redirect-timer { text-align: center; margin-top: 40px; font-size: 1.2rem; color: var(--text-light); }
    /* Footer */ .footer { background-color: var(--black); color: var(--gray-bg); padding: 60px 0 20px; } .footer-content { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 40px; margin-bottom: 40px; } .footer-about .logo { color: var(--white); } .footer-about p { color: #aab2bd; margin-top: 1rem; } .footer-links h4 { font-weight: 600; font-size: 1.1rem; margin-bottom: 1.5rem; color: var(--white); position: relative; padding-bottom: 10px; } .footer-links h4::after { content: ''; position: absolute; bottom: 0; left: 0; width: 30px; height: 2px; background-color: var(--sea-blue); } .footer-links ul { list-style: none; } .footer-links li:not(:last-child) { margin-bottom: 10px; } .footer-links li a { color: #aab2bd; } .footer-links li a:hover { color: var(--white); text-decoration: underline; } .footer-bottom { border-top: 1px solid #333; padding-top: 20px; text-align: center; color: #aab2bd; } .footer-bottom a { color: var(--white); font-weight: 600; }
    /* Back to Top Button */ #backToTop { position: fixed; bottom: 25px; right: 25px; width: 50px; height: 50px; background-color: var(--sea-blue); color: var(--white); border: none; border-radius: 50%; box-shadow: var(--shadow); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; opacity: 0; visibility: hidden; transition: all 0.3s ease; transform: translateY(20px); } #backToTop.visible { opacity: 1; visibility: visible; transform: translateY(0); } #backToTop:hover { background-color: var(--dark-blue); }
    /* Media Queries untuk Responsivitas */ @media (max-width: 768px) { .hero-title { font-size: 2.5rem; } .hero-subtitle { font-size: 1.1rem; } .nav-links { display: none; } .product-detail { flex-direction: column; } } @media (max-width: 480px) { .hero-title { font-size: 2rem; } .container { padding: 0 15px; } }`;
}
/**
 * Membuat HTML lengkap untuk Homepage.
 */
function createHomepageHTML(data, currentDomain) {
  const itemsHTML = createHomepageItemsHTML(data, currentDomain);
  return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${SITE_NAME} - Platform Belanja Online Terlengkap Cariolshop</title>
    <meta name="google-site-verification" content="wHfAhGUcdIgh8vsiEhUoUq9CchBFjY07a5NA9NChaDo" />
   
    <!-- Meta SEO Esensial -->
    <meta name="description" content="${SITE_NAME} adalah platform belanja online terlengkap dengan jutaan produk berkualitas. Temukan elektronik, fashion, gadget, dan kebutuhan sehari-hari dengan harga terbaik.">
    <meta name="keywords" content="${SITE_NAME}, belanja online, marketplace, produk murah, elektronik, fashion, gadget, toko online terlengkap">
    <meta name="author" content="${SITE_NAME}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${currentDomain}/">
    <link rel="icon" href="/favicon.ico" type="image/x-icon">
    <link rel="alternate" type="application/rss+xml" title="${SITE_NAME} RSS Feed" href="${currentDomain}/feed.xml">
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${currentDomain}/">
    <meta property="og:title" content="${SITE_NAME} - Platform Belanja Online Terlengkap">
    <meta property="og:description" content="Temukan jutaan produk berkualitas dengan harga terbaik di ${SITE_NAME}. Cariolshop Platform belanja online terlengkap untuk semua kebutuhan Anda.">
    <meta property="og:image" content="https://cariolshop.github.io/apple-icon.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="${SITE_NAME}">
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${currentDomain}/">
    <meta name="twitter:title" content="${SITE_NAME} - Platform Belanja Online Terlengkap">
    <meta name="twitter:description" content="Temukan jutaan produk berkualitas dengan harga terbaik di ${SITE_NAME}.">
    <meta name="twitter:image" content="https://cariolshop.github.io/apple-icon.png">
    <!-- Schema.org Markup -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "${SITE_NAME}",
      "url": "${currentDomain}",
      "description": "Platform belanja online terlengkap dengan jutaan produk berkualitas",
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://www.google.com/search?q=site:${currentDomain}+%7Bsearch_term_string%7D"
        },
        "query-input": "required name=search_term_string"
      }
    }
    </script>
    ${createAdsenseScript()}
   
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
   
    <style>
      ${createCSSStyles()}
    </style>
</head>
<body>
    ${createHeaderHTML(currentDomain)}
    <main>
        <section class="hero">
            <div class="container">
                <h1 class="hero-title">Temukan Produk Terbaik Pilihan Anda</h1>
                <p class="hero-subtitle">Cariolshop platform belanja online terlengkap dengan jutaan produk berkualitas. Dari elektronik hingga fashion, semua ada di sini!</p>
            </div>
            <!-- responsive -->
            <ins class="adsbygoogle"
                style="display:block"
                data-ad-client="ca-pub-8469029934963239"
                data-ad-slot="7614013167"
                data-ad-format="auto"
                data-full-width-responsive="true"></ins>
            <script>
                (adsbygoogle = window.adsbygoogle || []).push({});
            </script>
        </section>
        ${createSearchSectionHTML()}
        <section class="products-section">
            <div class="container">
                <div class="section-header">
                    <h2 class="section-title">Produk Terbaru & Terpopuler</h2>
                    <p class="section-subtitle">Koleksi produk pilihan yang selalu diperbarui setiap hari. Dapatkan penawaran terbaik sebelum kehabisan!</p>
                </div>
                <div class="product-grid">
                    ${itemsHTML}
                </div>
            </div>
        </section>
    </main>
    ${createFooterHTML(currentDomain)}
    ${createBackToTopHTML()}
  ${createGoogleAnalytics()}
</body>
</html>`;
}
/**
 * Membuat HTML lengkap untuk halaman Produk.
 */
function createProductHTML(productData, currentDomain, shopid, itemid) {
  const safeName = escapeHTML(sanitizeProductName(productData.name || 'Produk Tanpa Nama'));
  const seoDescription = `${safeName} - Temukan produk berkualitas tinggi dengan harga terbaik di ${SITE_NAME}. Belanja online aman dan nyaman untuk kebutuhan sehari-hari, elektronik, fashion, dan lebih banyak lagi. Dapatkan penawaran eksklusif sekarang!`;
  const mainImage = `https://i0.wp.com/cf.shopee.com/${productData.image || 'default'}_tn`;
  const destinationURL = `https://shopee.co.id/opaanlp/${shopid}/${itemid}?utm_source=an_11367000189&utm_medium=affiliates&utm_campaign=-&utm_content=cariolstore----&af_siteid=an_11367000189&pid=affiliates&af_click_lookback=7d&af_viewthrough_lookback=1d&is_retargeting=true&af_reengagement_window=7d&af_sub_siteid=cariolstore----&c=-&deep_and_deferred=1`;
  return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeName} - ${SITE_NAME}</title>
    <meta name="google-site-verification" content="wHfAhGUcdIgh8vsiEhUoUq9CchBFjY07a5NA9NChaDo" />
   
    <!-- Meta SEO Esensial -->
    <meta name="description" content="${seoDescription}">
    <meta name="keywords" content="${safeName}, ${SITE_NAME}, belanja online, produk murah, promo, diskon, shopee affiliate">
    <meta name="author" content="${SITE_NAME}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${currentDomain}/produk/${shopid}/${itemid}">
    <link rel="icon" href="/favicon.ico" type="image/x-icon">
    <link rel="alternate" type="application/rss+xml" title="${SITE_NAME} RSS Feed" href="${currentDomain}/feed.xml">
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="product">
    <meta property="og:url" content="${currentDomain}/produk/${shopid}/${itemid}">
    <meta property="og:title" content="${safeName} - ${SITE_NAME}">
    <meta property="og:description" content="${seoDescription}">
    <meta property="og:image" content="${mainImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="${SITE_NAME}">
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${currentDomain}/produk/${shopid}/${itemid}">
    <meta name="twitter:title" content="${safeName} - ${SITE_NAME}">
    <meta name="twitter:description" content="${seoDescription}">
    <meta name="twitter:image" content="${mainImage}">
    <!-- Schema.org Markup -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "ImageObject",
      "name": "${safeName}",
      "description": "${seoDescription}",
      "contentUrl": "${mainImage}",
      "thumbnailUrl": "${mainImage}",
      "creator": {
        "@type": "Person",
        "name": "${SITE_NAME}"
      },
      "encodingFormat": "image/jpeg",
      "copyrightNotice": "© ${SITE_NAME} Shop",
      "license": "https://www.cariolstore.com/p/terms-and-conditions.html",
      "creditText": "${SITE_NAME} Shop",
      "acquireLicensePage": "${currentDomain}/produk/${shopid}/${itemid}"
    }
    </script>
    ${createAdsenseScript()}
 
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
   
    <style>
      ${createCSSStyles()}
    </style>
</head>
<body>
    ${createHeaderHTML(currentDomain)}
    <main>
        ${createSearchSectionHTML()}
        ${createProductDetailHTML(productData)}
    </main>
    ${createFooterHTML(currentDomain)}
    ${createBackToTopHTML()}
    <script>
      // Countdown timer untuk redirect
      let countdown = 10;
      const countdownElement = document.getElementById('countdown');
      const timer = setInterval(() => {
        countdown--;
        countdownElement.textContent = countdown;
        if (countdown <= 0) {
          clearInterval(timer);
          window.location.href = '${destinationURL}';
        }
      }, 1000);
    </script>
    <script>
      // Simple gallery interaction (klik thumbnail ganti main image)
      const mainImage = document.querySelector('.main-image');
      const thumbnails = document.querySelectorAll('.gallery-image');
      thumbnails.forEach(thumb => {
        thumb.addEventListener('click', () => {
          mainImage.src = thumb.src;
        });
      });
    </script>
  ${createGoogleAnalytics()}
</body>
</html>`;
}
/**
 * Membuat halaman fallback jika terjadi error.
 */
function createFallbackHTML(errorMessage) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${SITE_NAME} - Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { background-color: white; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); padding: 2rem; text-align: center; max-width: 400px; margin: 1rem; }
    .icon { width: 64px; height: 64px; background-color: #fee2e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; }
    .icon svg { color: #ef4444; width: 32px; height: 32px; }
    h1 { font-size: 1.5rem; font-weight: bold; color: #1f2937; margin-bottom: 0.5rem; }
    p { color: #6b7280; margin-bottom: 1.5rem; }
    .button { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 0.75rem 1.5rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
    .button:hover { transform: scale(1.05); box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
    .error-msg { font-size: 0.75rem; color: #9ca3af; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>
    </div>
    <h1>Terjadi Kesalahan</h1>
    <p>Maaf, terjadi kesalahan saat memuat data produk. Silakan coba lagi nanti.</p>
    <button onclick="location.reload()" class="button">Coba Lagi</button>
    <p class="error-msg">Error: ${escapeHTML(errorMessage || 'Unknown error')}</p>
  </div>
</body>
</html>`;
}
