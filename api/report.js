// Receives click reports from the page and emails them via Resend (https://resend.com).
// Config (Vercel env vars, never in the page source):
//   REPORT_EMAIL   – where reports go (must be the email your Resend account uses, on the free tier)
//   RESEND_API_KEY – your Resend API key

const EVENTS = {
  opened: '👀 She opened your page',
  said_yes: '💖 She said YES!',
  left: '🚪 She left / switched away without saying yes'
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  let d = req.body;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return res.status(400).end(); }
  }
  if (!d || !EVENTS[d.event]) return res.status(400).end();

  const clean = v => String(v ?? '').slice(0, 300);
  const device = d.mobile ? 'Phone / tablet' : 'Computer';
  const noClicks = Math.max(0, d.noClicks | 0);

  const subject = d.event === 'opened'
    ? EVENTS.opened
    : `${EVENTS[d.event]} (${noClicks} "No" click${noClicks === 1 ? '' : 's'})`;

  const clickRows = d.event === 'opened'
    ? [['Clicks', 'She just opened it. "No" clicks, "Yes" hovers and time on page come in the next email (💖 YES or 🚪 left).']]
    : [
        ['"No" clicks', noClicks],
        ['Last "No" text she saw', clean(d.lastNoText) || '-'],
        ['Hovered over "Yes"', `${Math.max(0, d.yesHovers | 0)} time(s)`],
        ['Seconds on page', Math.max(0, d.secondsOnPage | 0)]
      ];
  const rows = [
    ['Event', EVENTS[d.event]],
    ['Name in link', clean(d.name) || '(none)'],
    ...clickRows,
    ['Device', device],
    ['Visit ID', clean(d.sid)]
  ];

  // always visible in `vercel logs` / the Vercel dashboard as a backup
  console.log('report', JSON.stringify(Object.fromEntries(rows)));

  // ignore Vercel's own bots / per-deployment preview URLs so you only get emails from the real link
  // (the user agent is only checked here, never stored or emailed)
  if (/HeadlessChrome|bot|crawler|spider|vercel/i.test(req.headers['user-agent'] || '') || /-lesterbonbiono-\d+\.vercel\.app$/i.test(req.headers.host || '')) {
    return res.status(200).json({ ok: true, emailed: false, reason: 'ignored (bot or preview URL)' });
  }

  const to = (process.env.REPORT_EMAIL || '').replace(/[^\x21-\x7E]/g, ''); // strip hidden characters
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!to || !key) return res.status(200).json({ ok: true, emailed: false, reason: 'email not configured' });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px">
      <h2 style="color:#e63e6d;margin:0 0 12px">${esc(subject)}</h2>
      <table cellpadding="8" style="border-collapse:collapse;width:100%;font-size:14px">
        ${rows.map(([k, v], i) => `<tr style="background:${i % 2 ? '#fff' : '#fff0f5'}"><td style="font-weight:bold;width:40%">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
      </table>
    </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: 'Something To Ask You <onboarding@resend.dev>', to: [to], subject, html })
    });
    const out = await r.text();
    if (!r.ok) console.error('resend', r.status, out.slice(0, 300));
    return res.status(200).json({ ok: r.ok, emailed: r.ok });
  } catch (e) {
    console.error('resend failed', e);
    return res.status(200).json({ ok: false });
  }
};
