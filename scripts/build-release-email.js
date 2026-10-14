#!/usr/bin/env node
//
// scripts/build-release-email.js - turn a release email HTML file into an
// .eml draft that opens in Outlook as a new, editable message with the
// design intact. Copy/pasting rendered HTML into Outlook mangles it; an
// .eml carries the HTML body as-is.
//
// Embedded data: URI images (the item icons) become inline attachments
// referenced by cid:, which is what Outlook renders reliably.
//
// Usage:
//   node scripts/build-release-email.js docs/release-notes/v0.7.0-email.html "What's new in Nowtify 0.7.0"
// Writes the .eml next to the HTML file.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [htmlPath, subject] = process.argv.slice(2);
if (!htmlPath || !subject) {
  console.error('Usage: node scripts/build-release-email.js <email.html> "<subject>"');
  process.exit(1);
}

let html = fs.readFileSync(htmlPath, 'utf8');
// Drop the authoring comment block; it's for us, not recipients.
html = html.replace(/<!--[\s\S]*?-->/g, '');

const images = [];
html = html.replace(/src="data:(image\/[a-z]+);base64,([^"]+)"/g, (_m, type, data) => {
  const cid = `img${images.length + 1}.${crypto.randomBytes(6).toString('hex')}@nowtify`;
  images.push({ cid, type, data, name: `icon-${images.length + 1}.${type.split('/')[1]}` });
  return `src="cid:${cid}"`;
});

const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const b64 = (s) => wrap76(Buffer.from(s, 'utf8').toString('base64'));
// RFC 2047 so non-ASCII (and apostrophes) in the subject survive every client.
const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
const boundary = `----=_nowtify_${crypto.randomBytes(8).toString('hex')}`;

const parts = [
  [
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
  ].join('\r\n'),
  ...images.map((img) =>
    [
      `--${boundary}`,
      `Content-Type: ${img.type}; name="${img.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.name}"`,
      '',
      wrap76(img.data),
    ].join('\r\n'),
  ),
];

const eml = [
  // X-Unsent makes Outlook open this as a draft to edit + send, not as a
  // received message.
  'X-Unsent: 1',
  'To: ',
  `Subject: ${encodedSubject}`,
  'MIME-Version: 1.0',
  `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
  '',
  ...parts,
  `--${boundary}--`,
  '',
].join('\r\n');

const out = htmlPath.replace(/\.html?$/, '') + '.eml';
fs.writeFileSync(out, eml);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${images.length} inline images)`);
