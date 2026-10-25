import { next, waitUntil } from '@vercel/functions';

// Ghi log IP của khách đến từ quảng cáo Google (URL có gclid) vào Upstash Redis.
// Lỗi ở bất cứ bước nào cũng bỏ qua: trang web luôn mở bình thường.
export const config = {
  matcher: ['/', '/cuu-ho-cao-toc-cao-bo-mai-son'],
};

const TTL_SECONDS = 30 * 24 * 60 * 60; // phương án dự phòng, script trên máy sẽ xóa sớm hơn
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s || '');
  } catch {
    return s || '';
  }
};

function describeUserAgent(ua) {
  const isBot = /bot|crawl|spider|adsbot|facebookexternalhit|lighthouse|headless|preview/i.test(ua);
  const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  const browser =
    /edg\//i.test(ua) ? 'Edge' :
    /coc_coc/i.test(ua) ? 'CocCoc' :
    /chrome\//i.test(ua) ? 'Chrome' :
    /safari\//i.test(ua) ? 'Safari' :
    /firefox\//i.test(ua) ? 'Firefox' : 'other';
  return { isBot, device, browser };
}

export default function middleware(request) {
  try {
    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const url = new URL(request.url);
    const gclid = url.searchParams.get('gclid');

    if (gclid && base && token && request.method === 'GET') {
      const h = request.headers;
      const ua = h.get('user-agent') || '';
      const { isBot, device, browser } = describeUserAgent(ua);
      const vnNow = new Date(Date.now() + VN_OFFSET_MS).toISOString(); // giờ Việt Nam, giả dạng UTC

      const record = {
        t: vnNow.slice(0, 19).replace('T', ' '),
        ip: h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim(),
        country: h.get('x-vercel-ip-country') || '',
        region: h.get('x-vercel-ip-country-region') || '',
        city: safeDecode(h.get('x-vercel-ip-city')),
        device,
        browser,
        bot: isBot ? 1 : 0,
        path: url.pathname,
        gclid: gclid.slice(0, 200),
        lang: (h.get('accept-language') || '').split(',')[0],
        ref: h.get('referer') || '',
      };

      const key = `iplog:${vnNow.slice(0, 10)}`;
      waitUntil(
        fetch(`${base}/pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([
            ['RPUSH', key, JSON.stringify(record)],
            ['EXPIRE', key, TTL_SECONDS],
          ]),
        }).catch(() => {}),
      );
    }
  } catch {
    // bỏ qua: không bao giờ làm hỏng trang
  }
  return next();
}
