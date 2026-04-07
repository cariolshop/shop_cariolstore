// =================================================================================
// Konfigurasi Worker & Konstanta
// =================================================================================
const config = {
  DEBUG_MODE: false,
  CACHE_TTL: {
    HOMEPAGE: 3600, // 1 Jam
    SEARCH: 3600,   // 1 Jam
    RSS_FEED: 86400,
    PRODUCT_ITEM: 2629800,
    FAVICON: 31536000,
    DEFAULT: 86400,
  },
};

const SITE_NAME = 'Cariolstore';
const ALT_SITE_NAME = 'Cariolshop';
const ORIGIN_HEADER = 'https://shop.cariolstore.com';

// =================================================================================
// Event Listener Utama
// =================================================================================
export default {
  async fetch(request, env, ctx) {
    if (config.DEBUG_MODE) {
      return await handleRequest(request);
    }
    
    const cache = caches.default;
    let cacheKey = new Request(request.url, { method: 'GET' });
    let response = await cache.match(cacheKey);
    
    if (!response) {
      response = await handleRequest(new Request(request.url, { method: 'GET' }));
      if (request.method === 'GET' && response.ok && !request.url.includes('/api/items')) {
        const responseToCache = response.clone();
        ctx.waitUntil(cache.put(cacheKey, responseToCache));
      }
    }
    
    if (request.method === 'HEAD') {
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  },
};

// =================================================================================
// Router Utama
// =================================================================================
async function handleRequest(request) {
  const url = new URL(request.url);
  const { pathname, searchParams, hostname } = url;
  const currentDomain = `https://${hostname}`;

  try {
    if (pathname === '/favicon.ico') return await handleFavicon();
    if (pathname === '/sitemap.xml') return await handleSitemap(currentDomain);
    if (pathname === '/feed.xml') return await handleRSSFeed(currentDomain);
    if (pathname === '/ads.txt') return await handleAds();
    if (pathname === '/robots.txt') return await handleRobots(currentDomain);
    
    // API Internal untuk Infinite Scroll
    if (pathname === '/api/items') return await handleApiItems(searchParams);
    
    // Route Pencarian
    if (pathname === '/search') return await handleSearch(searchParams.get('q'), currentDomain);
    
    // Route Produk Detail
    if (pathname.startsWith('/produk/')) return await handleProductItem(pathname, currentDomain);
    
    // Route Homepage
    if (pathname === '/') return await handleHomepage(currentDomain);

    // Default Fallback
    return Response.redirect(`${currentDomain}/`, 302);
  } catch (error) {
    console.error('Worker Error:', error);
    return new Response(createFallbackHTML(error.message, currentDomain), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }
}

// =================================================================================
// Handlers API & Data Fetching
// =================================================================================

async function fetchGraphQL(type, query = '', page = 1) {
  let endpoint = '';
  if (type === 'home') {
    endpoint = `https://api-graphql.cariolshop.qzz.io/home?page=${page}`;
  } else if (type === 'search') {
    endpoint = `https://api-graphql.cariolshop.qzz.io/search?q=${encodeURIComponent(query)}&page=${page}`;
  }

  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'CloudflareWorker/1.0',
      'Origin': ORIGIN_HEADER,
      'Referer': `${ORIGIN_HEADER}/`
    }
  });

  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const json = await response.json();
  return json?.data?.landingPageLinkList?.linkList ||[];
}

async function handleApiItems(searchParams) {
  const type = searchParams.get('type') || 'home';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const q = searchParams.get('q') || '';
  
  try {
    const data = await fetchGraphQL(type, q, page);
    return new Response(JSON.stringify({ success: true, data }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
}

// =================================================================================
// Handlers Halaman / Route
// =================================================================================

async function handleHomepage(currentDomain) {
  const data = await fetchGraphQL('home', '', 1);
  const html = createMainLayout(currentDomain, data, 'home', null);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.HOMEPAGE}`,
    },
  });
}

async function handleSearch(query, currentDomain) {
  if (!query) return Response.redirect(`${currentDomain}/`, 302);
  const data = await fetchGraphQL('search', query, 1);
  const html = createMainLayout(currentDomain, data, 'search', query);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.SEARCH}`,
    },
  });
}

async function handleProductItem(pathname, currentDomain) {
  const parts = pathname.split('/').filter(Boolean);
  const shopid = parts[1];
  const itemid = parts[2];

  if (!shopid || !itemid) {
    return Response.redirect(`${currentDomain}/`, 302);
  }

  const apiUrl = `https://shp-apis.cariolshop.qzz.io/produk/${itemid}/${shopid}`;
  let productData;
  try {
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'CloudflareWorker/1.0', 'Accept': 'application/json' },
    });
    if (!response.ok) throw new Error(`API merespons dengan status: ${response.status}`);
    const json = await response.json();
    if (!json.success || !json.data) throw new Error('Format respons API tidak valid.');
    productData = json.data;
  } catch (error) {
    return new Response(createFallbackHTML(error.message, currentDomain), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }

  const html = createProductDetailHTML(productData, currentDomain, shopid, itemid);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.PRODUCT_ITEM}`,
      'X-Robots-Tag': 'index, follow',
    },
  });
}

// =================================================================================
// Handlers Statis & SEO (XML, Txt)
// =================================================================================

async function handleSitemap(currentDomain) {
  const today = new Date().toISOString();
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${currentDomain}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.RSS_FEED}`,
    },
  });
}

async function handleRSSFeed(currentDomain) {
  const apiUrl = 'https://shp-apis.cariolshop.qzz.io/produks';
  let data =[];
  try {
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'CloudflareWorker/1.0', 'Accept': 'application/json' },
    });
    const json = await response.json();
    if (json.success && Array.isArray(json.data)) {
      data = json.data;
    }
  } catch (error) {
    console.error('Gagal memuat API RSS Feed:', error);
  }

  const items = data.slice(0, 100).map((item) => {
    if (!item.name || !item.shopid || !item.itemid) return '';
    const safeName = escapeXML(item.name);
    const link = `${currentDomain}/produk/${item.shopid}/${item.itemid}`;
    const image = `https://i0.wp.com/cf.shopee.com/${item.image}_tn`;
    return `
    <item>
      <title><![CDATA[${safeName}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[<a href="${link}"><img src="${image}" alt="${safeName}" /></a><br/>${safeName}]]></description>
      <enclosure url="${image}" type="image/jpeg" length="0"/>
    </item>`;
  }).join('');

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Katalog Terbaru ${SITE_NAME} &amp; ${ALT_SITE_NAME}</title>
    <link>${currentDomain}/</link>
    <description>Koleksi produk terpopuler pilihan ${SITE_NAME} (Cariolshop).</description>
    <atom:link href="${currentDomain}/feed.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;

  return new Response(feed, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=UTF-8',
      'Cache-Control': `public, max-age=${config.CACHE_TTL.RSS_FEED}`,
    },
  });
}

async function handleFavicon() {
  const response = await fetch('https://cariolshop.github.io/favicon.ico');
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${config.CACHE_TTL.FAVICON}`);
  return new Response(response.body, { status: response.status, headers });
}

async function handleAds() {
  return new Response('google.com, pub-8469029934963239, DIRECT, f08c47fec0942fa0', {
    headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': `public, max-age=${config.CACHE_TTL.FAVICON}` },
  });
}

async function handleRobots(currentDomain) {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${currentDomain}/sitemap.xml`, {
    headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': `public, max-age=${config.CACHE_TTL.FAVICON}` },
  });
}

// =================================================================================
// HTML Templates & UI Components (Profesional, Modern, & SEO Friendly)
// =================================================================================

function escapeHTML(text) {
  if (!text) return '';
  return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeXML(text) { return escapeHTML(text); }

function createCSS() {
  return `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
  
  :root {
    --primary: #ee4d2d; 
    --primary-hover: #d73d20;
    --bg-color: #f8fafc;
    --card-bg: #ffffff;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --border: #e2e8f0;
    --radius: 16px;
    --header-h: 70px;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.1);
    --shadow-md: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
  body { background-color: var(--bg-color); color: var(--text-main); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  a { text-decoration: none; color: inherit; }
  .container { max-width: 1280px; margin: 0 auto; padding: 0 16px; }
  
  /* Glassmorphism Header */
  header { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 50; border-bottom: 1px solid rgba(226, 232, 240, 0.8); height: var(--header-h); display: flex; align-items: center; }
  .header-inner { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 20px; }
  .logo { font-size: 1.4rem; font-weight: 800; color: var(--primary); white-space: nowrap; letter-spacing: -0.5px; }
  
  /* Elegant Search */
  .search-form { flex-grow: 1; display: flex; max-width: 500px; position: relative; }
  .search-form input { width: 100%; padding: 12px 20px; padding-right: 50px; background: #f1f5f9; border: 2px solid transparent; border-radius: 30px; outline: none; font-size: 0.95rem; font-weight: 500; transition: all 0.3s ease; color: var(--text-main); }
  .search-form input::placeholder { color: #94a3b8; font-weight: 400; }
  .search-form input:focus { border-color: #cbd5e1; background: #ffffff; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
  .search-form button { position: absolute; right: 5px; top: 5px; bottom: 5px; width: 40px; border-radius: 50%; background: var(--primary); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s, background 0.2s; }
  .search-form button:hover { background: var(--primary-hover); transform: scale(1.05); }

  /* Product Grid */
  .main-content { padding: 10px 0; min-height: calc(100vh - var(--header-h) - 100px); }
  .page-title { font-size: 1.5rem; margin-bottom: 25px; font-weight: 700; color: var(--text-main); letter-spacing: -0.5px; padding:10px;}
  
  .product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  @media (min-width: 640px) { .product-grid { grid-template-columns: repeat(3, 1fr); gap: 16px; } }
  @media (min-width: 900px) { .product-grid { grid-template-columns: repeat(4, 1fr); gap: 20px; } }
  @media (min-width: 1200px) { .product-grid { grid-template-columns: repeat(5, 1fr); gap: 24px; } }

  /* Premium Hover Card (Hidden URL) */
  .card { 
    position: relative; 
    background: var(--card-bg); 
    border-radius: var(--radius); 
    overflow: hidden; 
    cursor: pointer; 
    box-shadow: var(--shadow-sm);
    aspect-ratio: 1 / 1; 
    border: 1px solid var(--border);
    transition: box-shadow 0.4s ease, transform 0.4s ease;
  }
  .card:hover { transform: translateY(-5px); box-shadow: var(--shadow-md); border-color: transparent; }
  
  .card img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94); background: #f8fafc; }
  .card:hover img { transform: scale(1.08); }
  
  .card-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.85) 100%);
    opacity: 0;
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 20px 15px;
    transition: opacity 0.3s ease;
  }
  @media (max-width: 768px) {
    .card-overlay { opacity: 1; background: linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.75) 100%); padding: 15px 12px; }
  }
  .card:hover .card-overlay { opacity: 1; }

  .card-title { color: #ffffff; font-size: 0.9rem; font-weight: 600; line-height: 1.4; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
  .btn-buy-text { color: #facc15; font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 5px; transform: translateY(10px); transition: transform 0.3s ease; opacity: 0; }
  .card:hover .btn-buy-text { transform: translateY(0); opacity: 1; }
  @media (max-width: 768px) { .btn-buy-text { transform: translateY(0); opacity: 1; font-size: 0.75rem; } .card-title { font-size: 0.8rem;} }

  /* Loader Infinite Scroll */
  .loader { text-align: center; padding: 40px 0; color: var(--text-muted); font-weight: 500; display: none; }
  .loader.active { display: block; }
  .loader span { display: inline-block; width: 6px; height: 6px; background: var(--primary); border-radius: 50%; margin: 0 3px; animation: bounce 1.4s infinite ease-in-out both; }
  .loader span:nth-child(1) { animation-delay: -0.32s; }
  .loader span:nth-child(2) { animation-delay: -0.16s; }
  @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

  /* Product Detail Page */
  .detail-wrapper { background: var(--card-bg); border-radius: 24px; padding: 25px; box-shadow: var(--shadow-md); display: flex; flex-direction: column; gap: 30px; max-width: 900px; margin: 0 auto; border: 1px solid var(--border); }
  @media (min-width: 768px) { .detail-wrapper { flex-direction: row; padding: 40px; } }
  .detail-img { flex: 1; min-width: 0; position: relative; border-radius: 16px; overflow: hidden; background: #f8fafc; }
  .detail-img img { width: 100%; aspect-ratio: 1/1; object-fit: contain; }
  .detail-info { flex: 1.2; display: flex; flex-direction: column; }
  .detail-title { font-size: 1.6rem; font-weight: 700; margin-bottom: 15px; color: var(--text-main); line-height: 1.3; letter-spacing: -0.5px; }
  .detail-desc { font-size: 0.95rem; color: var(--text-muted); margin-bottom: 30px; white-space: pre-wrap; max-height: 250px; overflow-y: auto; padding-right: 10px; line-height: 1.6; }
  
  .btn-buy-large { display: flex; justify-content: center; align-items: center; width: 100%; background: linear-gradient(135deg, var(--primary) 0%, #ff6b4a 100%); color: white; padding: 16px 24px; border-radius: 12px; font-size: 1.1rem; font-weight: 700; box-shadow: 0 8px 20px rgba(238, 77, 45, 0.25); transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94); margin-top: auto; }
  .btn-buy-large:hover { transform: translateY(-3px); box-shadow: 0 12px 25px rgba(238, 77, 45, 0.35); }

  /* SEO Section Footer */
  .seo-section { margin-top: 50px; padding: 30px; background: #ffffff; border-radius: 16px; border: 1px solid var(--border); }
  .seo-section h2 { font-size: 1.2rem; color: var(--text-main); margin-bottom: 10px; font-weight: 700; }
  .seo-section p { font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; }
  .ads {padding:10px;}

  /* Footer */
  footer { background: transparent; padding: 40px 0; text-align: center; color: var(--text-muted); font-size: 0.9rem; font-weight: 500; }
  `;
}

function createScripts() {
  return `
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8469029934963239" crossorigin="anonymous"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-8RVGX1JFDH"></script>
    <script>
      window.dataLayer = window.dataLayer ||[];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-8RVGX1JFDH');
    </script>
  `;
}

function renderCards(data) {
  return data.map(item => {
    const safeLink = item.link.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const safeName = escapeHTML(item.linkName);
    return `
    <div class="card" onclick="window.open('${safeLink}', '_blank', 'noopener,noreferrer')" title="${safeName} - Rekomendasi ${ALT_SITE_NAME}">
      <img src="${item.image}" alt="${safeName} di ${SITE_NAME}" loading="lazy">
      <div class="card-overlay">
        <h3 class="card-title">${safeName}</h3>
        <span class="btn-buy-text">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
          Beli Sekarang
        </span>
      </div>
    </div>`;
  }).join('');
}

// Layout Utama (Home & Search - Dioptimalkan untuk SEO Cariolshop & Cariolstore)
function createMainLayout(currentDomain, data, type, query) {
  const isSearch = type === 'search';
  const title = isSearch 
    ? `Hasil Cari: "${escapeHTML(query)}" - ${SITE_NAME} | ${ALT_SITE_NAME}` 
    : `${SITE_NAME} - Inspirasi & Rekomendasi Produk Pilihan ${ALT_SITE_NAME}`;
  const desc = isSearch 
    ? `Temukan penawaran terbaik untuk ${escapeHTML(query)} di ${SITE_NAME}. Dapatkan kurasi produk unggulan dari ${ALT_SITE_NAME}.` 
    : `Jelajahi koleksi produk populer, tren fashion, elektronik, dan diskon terbaik hari ini di ${SITE_NAME}. Belanja aman dengan rekomendasi ${ALT_SITE_NAME}.`;
  
  const currentYear = new Date().getFullYear(); // Tahun dinamis selalu dieksekusi

  // Schema.org Website & Organization
  const schemaMarkup = `
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "${SITE_NAME}",
    "alternateName": "${ALT_SITE_NAME}",
    "url": "${currentDomain}/",
    "description": "Platform rekomendasi produk belanja online terlengkap",
    "publisher": {
      "@type": "Organization",
      "name": "${SITE_NAME}",
      "logo": "https://cariolshop.github.io/apple-icon.png"
    },
    "potentialAction": {
      "@type": "SearchAction",
      "target": "${currentDomain}/search?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  }`;

  const searchIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <meta name="keywords" content="${SITE_NAME}, ${ALT_SITE_NAME}, belanja online, produk rekomendasi, promo diskon shopee">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${currentDomain}${isSearch ? `/search?q=${encodeURIComponent(query)}` : '/'}">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="alternate" type="application/rss+xml" title="${SITE_NAME} RSS Feed" href="${currentDomain}/feed.xml">
  
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${currentDomain}">
  <meta name="google-site-verification" content="wHfAhGUcdIgh8vsiEhUoUq9CchBFjY07a5NA9NChaDo" />
  <script type="application/ld+json">${schemaMarkup}</script>
  
  <style>${createCSS()}</style>
  ${createScripts()}
</head>
<body>
  <header>
    <div class="container header-inner">
      <a href="/" class="logo" title="${SITE_NAME} | ${ALT_SITE_NAME}">${SITE_NAME}</a>
      <form class="search-form" action="/search" method="GET">
        <input type="text" name="q" placeholder="Cari inspirasi produk..." value="${isSearch ? escapeHTML(query) : ''}" autocomplete="off" required>
        <button type="submit" aria-label="Cari">${searchIcon}</button>
      </form>
    </div>
  </header>

  <main class="main-content container">
  <section class="ads">
  <ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-8469029934963239" data-ad-slot="7614013167" data-ad-format="auto" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  </section>

    <h1 class="page-title">${isSearch ? `Hasil Pencarian: "${escapeHTML(query)}"` : `Rekomendasi Produk Terbaik ${SITE_NAME} & ${ALT_SITE_NAME}`}</h1>
    
    <div class="product-grid" id="productGrid">
      ${data && data.length > 0 ? renderCards(data) : '<p style="grid-column: 1/-1; text-align:center; padding: 80px 0; font-size: 1.1rem; color: #94a3b8;">Oops, tidak ada produk yang ditemukan.</p>'}
    </div>
    
    ${data && data.length > 0 ? `
    <div class="loader active" id="loader">
      Menemukan lebih banyak... <span></span><span></span><span></span>
    </div>` : ''}

    ${!isSearch ? `
    <section class="seo-section">
      <h2>Tentang ${SITE_NAME} (${ALT_SITE_NAME})</h2>
      <p>
        <strong>${SITE_NAME}</strong> (atau lebih dikenal luas sebagai <strong>${ALT_SITE_NAME}</strong>) adalah platform kurasi produk 
        yang dirancang khusus untuk mempermudah pengalaman belanja online Anda. Kami menyajikan daftar inspirasi tren fesyen terbaru, gadget kekinian, 
        serta perlengkapan rumah tangga dengan harga terbaik. Jelajahi katalog kami dan temukan berbagai penawaran diskon eksklusif yang dijamin aman 
        dan terpercaya. Bergabunglah dengan ribuan pembeli cerdas lainnya yang mengandalkan <em>${ALT_SITE_NAME}</em> untuk rekomendasi harian mereka!
      </p>
    </section>
    ` : ''}
  </main>

  <footer>
    <div class="container">
      &copy; ${currentYear} <strong>${SITE_NAME}</strong> - by ${ALT_SITE_NAME}. All Rights Reserved.
    </div>
  </footer>

  <script>
    let currentPage = 1;
    let isLoading = false;
    let hasMore = true;
    let isLoaderVisible = false;
    const type = '${type}';
    const query = '${isSearch ? escapeHTML(query).replace(/'/g, "\\'") : ''}';
    const grid = document.getElementById('productGrid');
    const loader = document.getElementById('loader');
    
    const svgCart = \`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>\`;

    if (loader) {
      const observer = new IntersectionObserver((entries) => {
        isLoaderVisible = entries[0].isIntersecting;
        if (entries[0].isIntersecting && !isLoading && hasMore) {
          loadMoreData();
        }
      }, { rootMargin: '1000px' });
      observer.observe(loader);
    }

    async function loadMoreData() {
      isLoading = true;
      currentPage++;
      try {
        const res = await fetch(\`/api/items?type=\${type}&page=\${currentPage}\${query ? '&q='+encodeURIComponent(query) : ''}\`);
        const json = await res.json();
        
        if (json.success && json.data && json.data.length > 0) {
          json.data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'card';
            
            const safeLink = item.link.replace(/'/g, "\\\\'").replace(/"/g, "&quot;");
            
            div.setAttribute('onclick', \`window.open('\${safeLink}', '_blank', 'noopener,noreferrer')\`);
            div.setAttribute('title', item.linkName + ' - Rekomendasi ${ALT_SITE_NAME}');
            
            div.innerHTML = \`
              <img src="\${item.image}" loading="lazy" alt="\${item.linkName} di ${SITE_NAME}">
              <div class="card-overlay">
                <h3 class="card-title">\${item.linkName}</h3>
                <span class="btn-buy-text">\${svgCart} Beli Sekarang</span>
              </div>
            \`;
            grid.appendChild(div);
          });
        } else {
          hasMore = false;
          loader.innerHTML = "Semua inspirasi telah dimuat.";
          loader.style.animation = "none";
        }
      } catch (e) {
        console.error("Gagal memuat:", e);
      }
      isLoading = false;
      if (isLoaderVisible && hasMore) {
        loadMoreData();
      }
    }
  </script>
</body>
</html>`;
}

// Layout Halaman Produk Detail
function createProductDetailHTML(product, currentDomain, shopid, itemid) {
  const safeName = escapeHTML(product.name || 'Produk Pilihan');
  const safeDesc = escapeHTML(product.description || '').replace(/\n/g, '<br>');
  const plainDesc = (product.description || '').replace(/<[^>]*>?/gm, '').substring(0, 160) + '...';
  const mainImage = `https://i0.wp.com/cf.shopee.com/${product.image || 'default'}_tn`;
  const affiliateUrl = `https://shopee.co.id/opaanlp/${shopid}/${itemid}?utm_source=an_11367000189&utm_medium=affiliates&utm_campaign=-&utm_content=cariolstore----&af_siteid=an_11367000189&pid=affiliates&af_click_lookback=7d&af_viewthrough_lookback=1d&is_retargeting=true&af_reengagement_window=7d&af_sub_siteid=cariolstore----&c=-&deep_and_deferred=1`;

  const currentYear = new Date().getFullYear(); 

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName} - ${SITE_NAME} | ${ALT_SITE_NAME}</title>
  <meta name="description" content="Temukan dan beli ${safeName} dengan penawaran eksklusif. Baca deskripsi lengkap dan dapatkan harga terbaik hanya di ${SITE_NAME} (${ALT_SITE_NAME}).">
  <meta name="keywords" content="${safeName}, ${SITE_NAME}, ${ALT_SITE_NAME}, beli online, promo">
  <link rel="canonical" href="${currentDomain}/produk/${shopid}/${itemid}">
  
  <meta property="og:title" content="${safeName} - ${SITE_NAME}">
  <meta property="og:description" content="${escapeHTML(plainDesc)}">
  <meta property="og:image" content="${mainImage}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="${ALT_SITE_NAME}">

  <style>${createCSS()}</style>
  ${createScripts()}
</head>
<body>
  <header>
    <div class="container header-inner">
      <a href="/" class="logo" title="${SITE_NAME} | ${ALT_SITE_NAME}">${SITE_NAME}</a>
      <form class="search-form" action="/search" method="GET">
        <input type="text" name="q" placeholder="Cari inspirasi produk..." required>
        <button type="submit" aria-label="Cari">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </button>
      </form>
    </div>
  </header>

  <main class="main-content container">
    <article class="detail-wrapper">
      <div class="detail-img">
        <img src="${mainImage}" alt="${safeName} direkomendasikan oleh ${ALT_SITE_NAME}">
      </div>
      <div class="detail-info">
        <h1 class="detail-title">${safeName}</h1>
        <div class="detail-desc">${safeDesc}</div>
        
        <a href="${affiliateUrl}" class="btn-buy-large" rel="nofollow noopener" target="_blank" title="Beli ${safeName} di Shopee">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
          Checkout di Shopee
        </a>
      </div>
    </article>
  </main>

  <footer>
    <div class="container">&copy; ${currentYear} <strong>${SITE_NAME}</strong> - by ${ALT_SITE_NAME}. All Rights Reserved.</div>
  </footer>
</body>
</html>`;
}

function createFallbackHTML(errorMsg, currentDomain) {
  const currentYear = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terjadi Kesalahan - ${SITE_NAME}</title>
  <style>${createCSS()}</style>
</head>
<body>
  <header><div class="container header-inner"><a href="/" class="logo">${SITE_NAME}</a></div></header>
  <main class="main-content container" style="text-align:center; padding-top: 80px;">
    <h2 style="font-size:1.8rem;">Maaf, halaman tidak tersedia.</h2>
    <p style="color:var(--text-muted); margin: 15px 0;">Sistem kami sedang memuat pembaruan atau halaman tidak ditemukan.</p>
    <a href="/" style="display:inline-block; background:var(--primary); color:white; padding: 12px 24px; border-radius:30px; font-weight:600; margin-top:20px;">Kembali ke Beranda</a>
    <p style="margin-top:50px; font-size:11px; color:#cbd5e1;">Log: ${escapeHTML(errorMsg)}</p>
  </main>
  <footer><div class="container">&copy; ${currentYear} ${SITE_NAME} (${ALT_SITE_NAME})</div></footer>
</body>
</html>`;
}
