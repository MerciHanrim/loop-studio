# Protected share link

```
Spec ID: loop-share-protected/1
Status:  Frozen on release (v0.17.0)
```

Defines the optional password protection of a share link: _what a protected
link is_, _how it is sealed_, and _how it is opened_.

It is layered on `loop-share/1` ([`SEMANTICS-U.md`](SEMANTICS-U.md)) and changes
nothing in it. A plain `g1` link, its codec, its caps and its opening order are
exactly what that document says. A protected link carries the same bytes a
plain link carries, sealed. A behavioural change after the freeze is a new spec
id with a new fragment key (`p2`), never an edit here.

What `loop-share/1` really carries is recorded in
[`SEMANTICS-U-ERRATA.md`](SEMANTICS-U-ERRATA.md); this document relies on that
corrected statement.

---

## P0. Scope

In scope:

- a second kind of share link, chosen explicitly when a link is created;
- the sealed transport: key derivation, authenticated encryption, byte layout;
- the opening flow: structure check, password prompt, errors.

Out of scope:

- any server: accounts, password reset, link expiry, revocation;
- encrypting what is kept in browser storage;
- hiding the length of the ciphertext, or that a link exists.

## P1. Link shape

```
<public base> "#p1=" payload
payload = base64url( salt[16] | iv[12] | ciphertext | tag[16] )
```

- The public base is the fixed address of `loop-share/1` §U1.1, never `location`.
- `p` = protected, `1` = payload format. The prefix is the protocol header;
  there is **no header byte** inside the payload.
- base64url is the strict, unpadded alphabet of §U1.4.
- The overhead over the sealed bytes is 44 bytes (salt, IV, tag).

## P2. Method and fixed parameters

| item | value |
|---|---|
| plaintext | the zlib-wrapped DEFLATE (RFC 1950) of the UTF-8 Graph JSON: exactly the bytes a `g1` link base64url-encodes |
| key derivation | PBKDF2-HMAC-SHA-256, **600,000** iterations, 16-byte random salt |
| key input | the UTF-8 bytes of the password after NFC normalisation |
| cipher | AES-256-GCM, 12-byte random IV, 128-bit authentication tag |
| additional authenticated data | the UTF-8 bytes of `loop-share-protected/1` (22 bytes) |
| key handling | a non-extractable `CryptoKey`; usage `encrypt` only when sealing, `decrypt` only when opening |
| randomness | `crypto.getRandomValues`, a fresh salt and IV for every link |
| implementation | Web Crypto only; no cryptographic code is written or bundled |

**Nothing in a link selects a parameter.** The iteration count, the algorithms
and the lengths are fixed by this format and are never read from the link: a
count read from a link could be made large enough to stall a device. Changing
any of them needs a new fragment key.

The additional authenticated data binds the format identifier into the
authentication, so a payload re-labelled as another version or algorithm does
not open.

Compression comes before encryption because ciphertext does not compress. The
decompression cap of §U3.2 runs after decryption, unchanged.

The count was chosen from measurements on phones: 85 ms on an iPhone 15 Pro
(149 to 151 ms in Low Power Mode) and 101 ms on a mid-range Android phone
(119 ms in battery saver), with no frame gap above 50 ms. It matches the current
OWASP figure for PBKDF2-HMAC-SHA-256. There is no per-device calibration: the
device that creates a link is not the device that opens it.

## P3. Password

- Length is counted in **code points after NFC normalisation**: 12 to 128 when
  creating, 1 to 128 when opening.
- Leading and trailing whitespace is part of the password. Nothing is trimmed.
- Creating has a second field for confirmation and one show / hide control.
  Pasting and password managers are not blocked.
- Creating uses `autocomplete="new-password"`, opening
  `autocomplete="current-password"`. What a browser or a password manager offers
  to save or fill is theirs to decide and is not controlled here.
- **Loop Studio does not store or transmit the password or the key.** The UI
  says this sentence and not "not stored anywhere".
- The password is never put in the URL, in browser storage, in a store, on the
  clipboard, or in a log. It exists in the input element and, for the duration
  of one call, as an argument.

## P4. The fragment

`classifyFragment` (one classifier for both kinds of link):

| fragment | kind | handling |
|---|---|---|
| `p1=<payload>` | protected | §P6 |
| `p1`, `p1x…` (starts `p1`, is not `p1=…`) | a broken protected link | visible notice, fragment removed, no password asked |
| `p<n>=…`, n ≠ 1 | a protected link from a newer version | visible notice, **fragment kept**, so the same address opens after the app updates |
| `g…` | `loop-share/1` | unchanged |
| anything else | foreign | left untouched |

A build that predates this document classifies every `p…` fragment as foreign
and leaves it in the address bar (measured on the shipped v0.16.0 build), so it
never consumes a protected link.

As soon as a payload has passed the structure check of §P6 and its bytes are in
memory, the fragment is removed from the address bar. During a cancel, a failure
and a retry the sealed bytes are held in memory only. After a reload the link
has to be opened again.

A link is consumed at boot. A navigation that changes only the fragment of an
already open document does not open it, as with a plain link.

## P5. Creating

- The plain link is the default and behaves as `loop-share/1` says. Protection
  is an explicit choice in the same dialog.
- The dialog tells the sender to send the password some other way than the link,
  that a lost password cannot be recovered, and that the link is only as strong
  as its password.
- The outbound cap applies to the protected payload exactly as to a plain one:
  `SHARE_MAX_BYTES` (8 KiB) characters after `#p1=`. Over the cap is a hard
  reject shown inside the dialog, never a truncation. A document can therefore
  fit as a plain link and not as a protected one; the window is 59 characters.
- While the key is derived the dialog shows a status line and accepts no second
  submit.
- The link is what is copied. The address bar does not change.
- One shared action and one shared dialog serve desktop and the phone layout.

## P6. Opening

Fixed order, after the storage gate of issue #297 has let the app start:

1. structure check
2. sealed bytes copied to memory, fragment removed
3. password prompt
4. key derivation
5. decrypt and authenticate
6. bounded inflate (§U3.2)
7. parse and validate
8. replace confirmation (§U5.4)
9. exactly one load (§U5.5)
10. the first-run Welcome card, only after all of the above

**Structure check**, before any password is asked for: the payload is 60 to
8,192 characters of strict base64url and decodes to more than salt, IV and tag.
60 characters is salt + IV + tag + one byte.

**Before a correct password nothing from the shared document is drawn**, and
nothing derived from the ciphertext (a size, a node count) is shown. There is no
plaintext to show.

The prompt says whether the opened document will be kept in this browser (a
personal session) or not (a temporary session); the storage rule itself is
issue #297's.

One derivation runs at a time. Cancel leaves the current document and any run in
progress untouched; a derivation still running when Cancel is pressed is ignored
when it finishes. A press on the backdrop does not dismiss the prompt.

After a successful open the rules of `loop-share/1` apply: the replace
confirmation unless the session is the untouched sample, one load, no auto-run.

## P7. Without Web Crypto

Web Crypto exists only in a secure context. There is no fallback.

- Creating: the choice is disabled and the reason is shown. The plain link works.
- Opening a well-formed protected link: a notice says a current browser and
  HTTPS are required, and the fragment is **not** removed, so the link can be
  opened elsewhere.
- A broken link is reported as broken (§P4) here too; that check needs no
  cryptography.

## P8. Errors

| cause | password asked | shown | console | fragment |
|---|---|---|---|---|
| broken structure | no | notice: damaged or incomplete | one fixed line | removed |
| newer version (`p<n>`) | no | notice: update the app | one fixed line | kept |
| no Web Crypto | no | notice: requirement | one fixed line | kept |
| wrong password, failed authentication, damaged ciphertext | again, without limit | **one** message | **one** fixed line | already removed |
| authenticated, but the content is not a diagram | no retry | a different notice | one fixed line | already removed |

A wrong password, a changed salt, IV, ciphertext or tag, and a truncated link
are **indistinguishable**: the same text, the same console line, the same
state. The browser reports data shorter than the tag with a different message
than the other failures, so whatever the browser reports is dropped inside the
sealed transport and never shown or logged.

There is no retry limit and no lock-out. Offline guessing cannot be prevented,
and the dialog says so when a link is created.

Every failure leaves the current document and any run in progress untouched.

## P9. What it does not claim

- It cannot hide the length of the ciphertext, which follows the size and the
  compressibility of the document, or the fact that a link was used.
- It is only as strong as the password. The ciphertext, the salt and the IV stay
  in browser history, on the clipboard and in chat logs, so guesses can be tried
  offline with no limit on attempts.
- It is not sign-in and not access control. Anyone with the link and the
  password can open, edit and re-share the document as a plain link.
- A JavaScript string cannot be erased. The claim is that the password is not
  stored and not transmitted, not that it leaves memory at a known moment.

## P10. Compatibility

| reader | link | result |
|---|---|---|
| a build before `loop-share-protected/1` | `p1=…` | foreign fragment, left in the address bar; opens after the update |
| this build | `p1=…` | §P6 |
| this build | `p<n>=…`, n ≠ 1 | notice, fragment kept |
| this build | any `g…` fragment | `loop-share/1`, unchanged |
| web, installed PWA, portable `file://` | each other's `p1=` link | must open (a link always targets the public base) |

The graph wire format is unchanged (`loop-studio/graph` `version: 1`).

## P11. Constants

| name | value |
|---|---|
| protected prefix | `"p1="` |
| format identifier (AAD) | `loop-share-protected/1` |
| iterations | `600000` |
| salt / IV / tag | 16 / 12 / 16 bytes |
| payload bounds | 60 to `SHARE_MAX_BYTES` (8,192) characters |
| password, creating | 12 to 128 code points after NFC |
| password, opening | 1 to 128 code points after NFC |
| decoded cap | `SHARE_MAX_DECODED_BYTES` (1 MiB), from `loop-share/1` |

`npm run check:share-crypto` keeps the key and cipher calls in
`src/model/shareProtected.ts`, the iteration count and the identifier written
once, and `package.json` free of cryptography libraries.

## P12. Acceptance vectors

The unit tests carry an independent implementation (node:crypto and node:zlib)
and compare in both directions: each side opens what the other sealed. Product
code has no way to be handed a salt or an IV.

Known answer, made with the independent implementation:

```
password   correct horse battery staple
salt       000102030405060708090a0b0c0d0e0f
iv         a0a1a2a3a4a5a6a7a8a9aaab
plaintext  zlib( {"schema":"loop-studio/graph","version":1,"nodes":[],"edges":[]} )
payload    AAECAwQFBgcICQoLDA0OD6ChoqOkpaanqKmqq9PyGNZRewug-mdGAFZfxHzXjsIb0FFAeYydCqMS_nEtA-vbA5mP6DAdST51g7zuZ6-6wrsnUiGAb8oALBa6Bcuaj-G48CwYYw5iJ6d5PPVB2iAd
```

Mutations of the independent side that must not open: another identifier as
additional authenticated data, none at all, 599,999 iterations.

Measured sizes at v0.17.0: every bundled template in every shipped language fits
the cap as a protected link; the largest is the MMO progression template in
Thai, 7,000 characters plain and 7,059 protected, and 7,983 with the pure
JavaScript compressor used where `CompressionStream` is missing.

## P13. Not verified

- What a browser or a password manager offers to save or fill.
- Web Crypto on `file://` outside Chromium.
- A real screen reader.
- Key derivation time on a low-end phone.
