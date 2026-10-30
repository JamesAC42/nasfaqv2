const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { escapeHtml } = require("../src/services/email");
const { passwordResetEmail, verificationEmail } = require("../src/services/emailTemplates");

const env = { PUBLIC_APP_BASE_URL: "https://holo.example/" };
const username = `<b>"Tom" & 'Jerry'</b>`;

const EMAILS = [
  {
    name: "verification",
    render: verificationEmail,
    url: "https://holo.example/verify-email?token=abc_DEF-123&x=1",
    subject: "Verify your NASFAQ account",
    button: "Verify my email",
    expiry: "This link expires soon.",
  },
  {
    name: "password reset",
    render: passwordResetEmail,
    url: "https://holo.example/reset-password?token=abc_DEF-123&x=1",
    subject: "Reset your NASFAQ password",
    button: "Choose a new password",
    expiry: "the link works once, for an hour",
  },
];

const reEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const { name, render, url, subject, button, expiry } of EMAILS) {
  test(`${name} email: branded HTML with the link in the button and the fallback`, () => {
    const email = render({ username, url }, env);
    assert.equal(email.subject, subject);
    const { html } = email;
    const href = `href="${escapeHtml(url)}"`; // the & in a query string is &amp; in HTML

    // The button comes first; under it, the same link spelled out.
    const [top, fallback] = html.split("Button not working? Paste this into your browser:");
    assert.ok(fallback, "has the fallback line");
    assert.match(top, new RegExp(`<a ${reEscape(href)}[^>]*>(?:<!--[\\s\\S]*?-->)?${button}<`));
    assert.ok(fallback.includes(`<a ${href}`) && fallback.includes(`>${escapeHtml(url)}</a>`));
    assert.ok(!html.includes(`href="${url}"`));

    // Whatever the username is, it can't become markup.
    assert.ok(html.includes(escapeHtml(username)));
    assert.ok(!html.includes(username));

    // Email-client rules: absolute images with alt text, inline styles, nothing to load or run.
    assert.match(html, /<img src="https:\/\/holo\.example\/email\/nasfaq-wordmark\.png"[^>]* alt="NASFAQ"/);
    assert.ok(!/<script|<style|<link|@import|@font-face/i.test(html));
    assert.match(html, /<div style="display:none;[^"]*mso-hide:all;[^"]*">[^<]{20,}/, "hidden preheader");
    assert.ok(html.includes(expiry));
    assert.ok(html.includes('href="https://holo.example/"'));
  });

  test(`${name} email: a plain-text part with the link on its own line`, () => {
    const { text } = render({ username, url }, env);
    assert.ok(text.includes(`\n${url}\n`));
    assert.ok(text.includes(username)); // plain text: nothing to escape
    assert.ok(text.includes(expiry));
    assert.ok(!/<[a-z]/i.test(text.replace(username, "")));
    assert.ok(text.endsWith("https://holo.example/"));
  });
}

test("the emails point at the site the link is on when PUBLIC_APP_BASE_URL isn't set", () => {
  const { html, text } = passwordResetEmail({ username: "honk", url: "https://holo.nasfaq.biz/reset-password?token=t" }, {});
  assert.ok(html.includes('src="https://holo.nasfaq.biz/email/nasfaq-wordmark.png"'));
  assert.ok(text.endsWith("https://holo.nasfaq.biz/"));
});

test("the wordmark the emails load is in app-client/public", () => {
  const file = path.join(__dirname, "..", "..", "app-client", "public", "email", "nasfaq-wordmark.png");
  assert.equal(fs.readFileSync(file).subarray(1, 4).toString(), "PNG");
});
