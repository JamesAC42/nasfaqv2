// The account emails (verification, password reset) and the branded layout they share. Email
// clients are not browsers: everything is tables and inline styles, no web fonts, no <style>
// (not every client keeps it), and every coloured cell repeats its colour as a bgcolor attribute so
// the dark design survives clients that strip one or the other. Colours are the site's dark theme
// (app-client/app/styles/_theme.scss); the wordmark is app-client/public/email/nasfaq-wordmark.png,
// the header logo drawn on the card colour so it reads on any background.

const { appUrl, escapeHtml } = require("./email");

const COLOR = {
  page: "#0a0c11", // --ink
  card: "#0f1219", // --ink-2
  rule: "#222838", // --rule
  text: "#eceef2", // --text
  mid: "#a7aebe", // --mid
  dim: "#7a8296", // --dim (also readable on white, for the footer outside the card)
  blue: "#3fb8f5", // --blue
  blueInk: "#02121c", // --blue-ink, text on a blue fill
};
const FONT_BODY = "'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,'Helvetica Neue',Arial,sans-serif";
const FONT_MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";
const WORDMARK = { path: "/email/nasfaq-wordmark.png", width: 141, height: 44 };

// Pads the inbox preview after the preheader so it doesn't run on into the body copy.
const PREVIEW_FILLER = "&#847;&zwnj;&nbsp;".repeat(80);

/** `path` on the site: PUBLIC_APP_BASE_URL, or else the site the email's own link points at. */
const siteUrl = (path, linkUrl, env) => appUrl(path, env) || new URL(path, linkUrl).href;

/**
 * One branded email. Text fields are plain text (escaped here) except `paragraphs` and `notes`,
 * which are HTML: escape anything a user typed before putting it in. Returns the HTML document.
 */
function accountEmailHtml({ subject, preheader, kicker, heading, paragraphs, button, notes = [], footer }, env = process.env) {
  const url = escapeHtml(button.url);
  const site = siteUrl("/", button.url, env);
  const siteLabel = escapeHtml(new URL(site).host);
  const p = (html, last) => `<p style="margin:0${last ? "" : " 0 14px"};">${html}</p>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${COLOR.page};word-spacing:normal;">
<div role="article" aria-roledescription="email" aria-label="${escapeHtml(subject)}" lang="en" style="background-color:${COLOR.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COLOR.page};">${escapeHtml(preheader)}${PREVIEW_FILLER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.page}" style="background-color:${COLOR.page};">
<tr><td align="center" style="padding:28px 8px 32px;">
<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td height="3" bgcolor="${COLOR.blue}" style="height:3px;font-size:0;line-height:0;background-color:${COLOR.blue};">&nbsp;</td></tr>
<tr><td bgcolor="${COLOR.card}" style="background-color:${COLOR.card};border:1px solid ${COLOR.rule};border-top:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.card}" style="background-color:${COLOR.card};">
<tr><td style="padding:20px 28px 0 22px;"><a href="${escapeHtml(site)}" target="_blank" style="text-decoration:none;"><img src="${escapeHtml(siteUrl(WORDMARK.path, button.url, env))}" width="${WORDMARK.width}" height="${WORDMARK.height}" alt="NASFAQ" style="display:block;width:${WORDMARK.width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT_MONO};font-size:22px;font-weight:700;line-height:${WORDMARK.height}px;color:${COLOR.text};"></a></td></tr>
<tr><td style="padding:22px 28px 0;font-family:${FONT_MONO};font-size:11px;font-weight:700;line-height:16px;letter-spacing:0.14em;text-transform:uppercase;color:${COLOR.blue};">${escapeHtml(kicker)}</td></tr>
<tr><td style="padding:8px 28px 0;"><h1 style="margin:0;font-family:${FONT_MONO};font-size:24px;font-weight:700;line-height:31px;letter-spacing:-0.01em;color:${COLOR.text};">${escapeHtml(heading)}</h1></td></tr>
<tr><td style="padding:16px 28px 0;font-family:${FONT_BODY};font-size:15px;line-height:24px;color:${COLOR.mid};">
${paragraphs.map((html, i) => p(html, i === paragraphs.length - 1)).join("\n")}
</td></tr>
<tr><td style="padding:22px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" bgcolor="${COLOR.blue}" style="background-color:${COLOR.blue};border-radius:2px;">
<a href="${url}" target="_blank" style="display:block;padding:16px 20px;font-family:${FONT_MONO};font-size:14px;font-weight:700;line-height:20px;letter-spacing:0.12em;text-transform:uppercase;text-align:center;text-decoration:none;color:${COLOR.blueInk};background-color:${COLOR.blue};border-radius:2px;mso-padding-alt:0;text-underline-color:${COLOR.blue};"><!--[if mso]><i style="mso-font-width:100%;mso-text-raise:32pt" hidden>&emsp;</i><span style="mso-text-raise:16pt;"><![endif]-->${escapeHtml(button.label)}<!--[if mso]></span><i hidden>&emsp;&#8203;</i><![endif]--></a>
</td></tr>
</table>
</td></tr>
${notes.length ? `<tr><td style="padding:18px 28px 0;font-family:${FONT_BODY};font-size:14px;line-height:22px;color:${COLOR.mid};">
${notes.map((html, i) => p(html, i === notes.length - 1)).join("\n")}
</td></tr>` : ""}
<tr><td style="padding:26px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${COLOR.rule}" style="height:1px;font-size:0;line-height:0;background-color:${COLOR.rule};">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:18px 28px 26px;font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${COLOR.dim};word-break:break-all;">
<p style="margin:0 0 6px;word-break:normal;">Button not working? Paste this into your browser:</p>
<p style="margin:0;"><a href="${url}" target="_blank" style="font-family:${FONT_MONO};font-size:12px;line-height:18px;color:${COLOR.blue};text-decoration:underline;word-break:break-all;">${url}</a></p>
</td></tr>
</table>
</td></tr>
<tr><td bgcolor="${COLOR.page}" style="padding:20px 28px 0;background-color:${COLOR.page};font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${COLOR.dim};">
<p style="margin:0 0 8px;">${escapeHtml(footer)}</p>
<p style="margin:0;"><a href="${escapeHtml(site)}" target="_blank" style="color:${COLOR.dim};text-decoration:underline;">${siteLabel}</a> &middot; the hololive stock market, with play money</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
}

/** The plain-text part: paragraphs, then the site, separated by blank lines. */
function accountEmailText(blocks, linkUrl, env = process.env) {
  return [...blocks, `NASFAQ, the hololive stock market: ${siteUrl("/", linkUrl, env)}`].join("\n\n");
}

/** Sent at sign-up and on "resend": the link that verifies `url`'s address for `username`. */
function verificationEmail({ username, url }, env = process.env) {
  const subject = "Verify your NASFAQ account";
  const footer = "You got this because this address was used to make a NASFAQ account. If that wasn't you, ignore this email and the account stays unverified.";
  return {
    subject,
    html: accountEmailHtml(
      {
        subject,
        preheader: "One click and you can trade, chat, comment and write.",
        kicker: "Verify your email",
        heading: "One click and you're in",
        paragraphs: [
          `Welcome to NASFAQ, <strong style="color:${COLOR.text};font-weight:700;">${escapeHtml(username)}</strong>.`,
          "Verify this email address and you can trade, chat, comment and write.",
        ],
        button: { label: "Verify my email", url },
        notes: ["This link expires soon."],
        footer,
      },
      env
    ),
    text: accountEmailText(
      [
        `Welcome to NASFAQ, ${username}. Verify this email address and you can trade, chat, comment and write.`,
        `Verify your NASFAQ account:\n${url}`,
        "This link expires soon.",
        footer,
      ],
      url,
      env
    ),
  };
}

/** A password reset link for `username`'s account. The link works once, for an hour. */
function passwordResetEmail({ username, url }, env = process.env) {
  const subject = "Reset your NASFAQ password";
  const ignore = "If that wasn't you, ignore this email. Your password hasn't changed.";
  const footer = "You got this because someone asked to reset the password for the NASFAQ account on this address.";
  return {
    subject,
    html: accountEmailHtml(
      {
        subject,
        preheader: "The link works once, for an hour. Didn't ask? Ignore this email.",
        kicker: "Password reset",
        heading: "Choose a new password",
        paragraphs: [
          `Someone asked to reset the password for your NASFAQ account, <strong style="color:${COLOR.text};font-weight:700;">${escapeHtml(username)}</strong>.`,
          "Choose a new password here (the link works once, for an hour):",
        ],
        button: { label: "Choose a new password", url },
        notes: [ignore],
        footer,
      },
      env
    ),
    text: accountEmailText(
      [
        `Someone asked to reset the password for your NASFAQ account, ${username}.`,
        `Choose a new password here (the link works once, for an hour):\n${url}`,
        ignore,
        footer,
      ],
      url,
      env
    ),
  };
}

module.exports = { accountEmailHtml, passwordResetEmail, verificationEmail };
