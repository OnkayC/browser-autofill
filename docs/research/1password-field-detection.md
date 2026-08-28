# 1Password field detection: public evidence and reusable patterns

Date: 2026-08-28

## Question and scope

This note investigates how 1Password's browser extension recognizes login fields, especially localized or opaque username fields, and what `browser-autofill` can safely borrow. It uses first-party 1Password pages, a public 1Password repository, the HTML Living Standard, and the current local source. It does **not** inspect or copy the distributed extension's proprietary or minified code.

The supplied [Chrome Web Store listing](https://chromewebstore.google.com/detail/1password-%E2%80%93-password-mana/aeblfdkhhhdcdjpifhhbdiojplfjncoa?hl=en) identifies the official extension and its general save/fill behavior, but it does not document the field-detection algorithm.

## Confirmed facts from primary sources

### 1Password uses more than an English keyword list

1Password's official 1.8.0 release notes say that the browser extension introduced a **machine-learning classifier model** to make decisions while filling and saving, and separately say that machine learning made login-form filling more accurate. The same release says page analysis became faster and more reliable, and that the inline menu began appearing in username fields without an accompanying password field. The release does not publish the model, training data, features, thresholds, or source code. ([1Password browser release 1.8.0](https://releases.1password.com/b5x/stable/1.8.0/))

The official 2.12.0 stable release notes say that username fields became recognizable in additional languages. They do not list the languages or explain whether this was implemented through model changes, dictionaries, rules, or a combination. ([1Password browser release 2.12.0](https://releases.1password.com/b5x/stable/2.12.0/))

The release history also shows continual classifier tuning rather than a single universal rule: release 1.23.0 reports more accurate suggestions in login and registration forms, smarter selection of item fields when filling a username/password item, fewer suggestions in irrelevant email/account fields, and fixes for specific fields and sites. ([1Password browser release 1.23.0](https://releases.1password.com/b5x/stable/1.23.0/))

**What this confirms:** 1Password has used a classifier and has explicitly invested in multilingual recognition and false-positive reduction.

**What it does not confirm:** the exact algorithm, whether the current 2026 extension still uses the same model architecture, or how a Chinese label such as `用户名称*` is weighted today.

### 1Password treats form structure and field relationships as useful signals

1Password's website compatibility guidance asks authors to:

- give each field and form a unique `id` or `name`;
- put inputs inside forms;
- group related username and password fields in the same form;
- separate unrelated fields into different forms;
- use proper labels and ARIA annotations;
- use placeholders rather than overlays;
- avoid generated field names/IDs;
- prefer stable fields that are reused and hidden rather than dynamically added and removed; and
- use appropriate `autocomplete` attributes because they make fields easier for 1Password to identify.

These are explicitly described as clues that help 1Password understand a page. ([Design your website to work best with 1Password](https://www.1password.dev/web/compatible-website-design))

The HTML Living Standard aligns with this design. It defines `autocomplete="username"` as “a username” and `autocomplete="current-password"` as the current password for the account identified by the username field. When the field name is merely `on`, it says user agents should use heuristics including the control's `name`, its position in the document tree, and other fields in the form. ([HTML Living Standard: autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill))

**Confirmed:** 1Password publicly recommends exposing form relationships, stable identifiers, accessibility metadata, and exact autocomplete semantics. The HTML standard explicitly names control names, tree position, and other fields in the form as heuristic inputs.

**Inference for this repository:** those sources support using a same-form, preceding-text-field fallback for a localized username when no English keyword matches. They do not confirm 1Password's exact weight or threshold for that fallback.

### 1Password uses standard autocomplete field names as a shared vocabulary

1Password's public `extension-messaging` repository requires callers to identify fields using the `autocomplete` names defined by the HTML Living Standard. Its Login example uses `username` and `current-password`. ([1Password/extension-messaging](https://github.com/1Password/extension-messaging))

**Confirmed:** this public integration boundary uses HTML autocomplete names as its field-type vocabulary. This repository is not the extension's detector source.

**Inference for this repository:** exact autocomplete tokens should outrank fuzzy matches against arbitrary labels and attributes.

### 1Password can remember page-specific field metadata

1Password's support documentation says that saving a Login records the username, password, and information entered in other fields. It also says those additional fields can later be filled, and the troubleshooting guide says a manual save records the form fields even when 1Password does not detect them automatically. ([Save and fill passwords](https://support.1password.com/save-fill-passwords/), [browser troubleshooting](https://support.1password.com/1password-browser-troubleshooting/))

**Confirmed behavior:** saved Login data can include more than the two canonical credential values and can preserve information learned from a particular page.

**Inference:** 1Password may use saved page-field metadata to improve later matching, but the public documents do not reveal the matching key or algorithm. A similar capability in this project would require protocol/storage changes and is not necessary for the immediate localized-label fix.

### Detection is constrained by security and visibility policy

1Password says it will not autofill without user input. For Login items inside an iframe, it will not fill if the item's URL does not match the iframe origin. It also says it uses multiple checks to avoid filling hidden fields, with limited exceptions for Identity items. ([1Password browser autofill security](https://support.1password.com/browser-autofill-security/))

1Password also documents `data-1p-ignore` and `data-op-ignore` as explicit site-author signals to suppress filling for a field or whole page. ([Design your website to work best with 1Password](https://www.1password.dev/web/compatible-website-design))

**What this confirms:** widening detection should be paired with negative signals, origin checks, visibility checks, and explicit user intent. A broader username fallback should not mean “fill any nearby text box.”

## Comparison with this repository

The current local behavior is simpler and mostly Boolean:

| Concern | Current `browser-autofill` | Publicly documented 1Password pattern | Consequence |
| --- | --- | --- | --- |
| Semantic metadata | `PageAnalyser.isUsernameInput()` accepts text-like types and fuzzy-matches a short keyword list against attributes and labels (`src/Content/PageAnalyser.ts:91-116`). `autocomplete` is only one string searched for those keywords (`:142`). | Exact HTML autocomplete field names are a canonical vocabulary. | Give valid `autocomplete="username"` a high-confidence, exact-token path rather than treating it like another fuzzy string. |
| Localized labels | The list is mainly English plus a few German terms (`PageAnalyser.ts:98-112`). `用户名称*` matches none. | Release notes confirm both ML classification and expanded language recognition. | Adding Chinese words is a useful tactical patch but not a durable general solution. |
| Structure | Username and password inputs are collected independently (`PageAnalyser.ts:7-20`); form ownership, DOM order, and distance to a password are not part of classification. | 1Password asks sites to group related fields in one form; HTML explicitly identifies tree position and other form fields as heuristic inputs. | Rank username/password pairs from one page snapshot, within one form/context. |
| Accessibility | The code reads native labels, adjacent sibling labels, and `aria-label` (`PageAnalyser.ts:154-165,188-208`). It does not resolve `aria-labelledby` text. | 1Password says labels and ARIA annotations provide field-location clues. | Build a fuller accessible-name signal, including `aria-labelledby` references. |
| Negative evidence | A separate fuzzy `search` test is the principal semantic exclusion (`PageAnalyser.ts:119-129`). The generic attribute scan can match unrelated attribute values (`:170-183`). | 1Password release notes show continuing work to suppress suggestions in irrelevant fields; its developer docs expose explicit ignore markers. | Use explicit penalties/exclusions for search, OTP, new-password, hidden, disabled, readonly, and unrelated form context. Avoid accepting any arbitrary attribute as equally strong evidence. |
| Visibility | Inputs narrower than 50px are removed, then viewport intersection is checked (`PageAnalyser.ts:49-82`). | 1Password documents “a variety of checks” for hidden fields and security-sensitive exceptions. | Keep visibility as a policy layer, not as a proxy for semantic classification; include disabled/readonly and rendered visibility. |
| Iframes | The analyser attempts to read top-level iframe documents directly (`PageAnalyser.ts:30-45`), which only works where DOM access is permitted. | 1Password gates Login filling in iframes by iframe origin matching. | Analyze each frame in its own content-script context and gate credential filling on origin, rather than merging frames blindly. |
| Result semantics | `AutoFiller.doIt()` returns `true` if either a username or password was filled (`src/Content/AutoFiller.ts:13-55`). | 1Password acknowledges partial fills can occur due to iframe security constraints. | Return/report which credential parts were filled; do not present password-only fill as full login completion. |

## Recommended design to borrow

Borrow the **layered classifier architecture**, not the undisclosed ML implementation.

### Phase 1: deterministic, language-independent scoring

Analyze the page once and score candidates as related pairs:

1. Partition visible, enabled, editable controls by `input.form`; use a conservative document/fieldset/dialog fallback only for controls without a form owner.
2. Detect password roles first using exact signals:
   - `autocomplete="current-password"` for a login password;
   - `autocomplete="new-password"` as a strong exclusion from login filling;
   - `type="password"` as a weaker role signal when autocomplete is absent.
3. Score username candidates in the same context:
   - very high: exact autocomplete token `username`;
   - high: existing semantic keyword match in `id`, `name`, placeholder, title, or accessible name;
   - medium: `type="email"` or `type="tel"` in a login form;
   - structural fallback: the nearest eligible text/email/tel input **before** the selected current-password field in DOM order;
   - penalties/exclusions: search, `one-time-code`, `new-password`, hidden, disabled, readonly, explicit ignore marker, or an unrelated form.
4. Require a confidence threshold and deterministic tie-breaking (same form, closest preceding field, then DOM order). Do not fill a low-confidence alternative merely because it exists.

This directly handles `用户名称*`: its label need not be translated if it is the visible eligible field immediately preceding a password in the same form. It also retains the current positive keyword behavior for standalone/multi-step username pages, where no password is present.

### Phase 2: improve accessible and multilingual signals

- Resolve native `<label for>`, wrapping labels, `aria-label`, and `aria-labelledby` references into one accessible-name feature.
- Add a small, tested localized synonym set only as an additional positive feature. Do not let it become the sole strategy.
- Keep features and weights explainable in diagnostics so a misclassification can be reproduced without inspecting user credentials.

### Phase 3: page-specific learning only if needed

If the credential protocol later supports saved web-form metadata, persist a privacy-preserving field signature (for example, origin plus stable form/field identifiers and role), and use it as another strong signal on return visits. The public 1Password documents confirm the behavior of recording additional form fields, but not an implementation that can be copied.

### Fill result and security changes

- Replace the single `filledSomething` outcome with a structured result such as `{ usernameFilled, passwordFilled }` so the UI can distinguish complete, partial, and failed fills.
- Preserve explicit user activation.
- Treat frame origin matching as a prerequisite for Login filling in a frame.
- Keep a conservative threshold: a password-only form may be intentional, and an ambiguous text field should remain unfilled.

## What not to borrow

- Do not copy, de-minify, or reverse engineer the Chrome Web Store bundle.
- Do not assume “machine learning” alone is the answer. 1Password publishes neither its model nor its failure tradeoffs, and this repository can solve the observed case with testable structural evidence.
- Do not blindly add every localized translation of “username”; that grows indefinitely and still fails opaque/generated fields.
- Do not fill every text field before a password. Form ownership, visibility/editability, negative semantics, proximity, and confidence are essential.
- Do not treat 1Password's 11 extension UI languages in the Chrome Web Store listing as proof of the field classifier's supported languages; those are different claims.

## Proposed regression cases before implementation

1. Chinese label `用户名称*`, opaque `id`/`name`, text field immediately before a password in the same form: fill both.
2. Same layout with a search box earlier in the form: choose the nearest preceding non-search field.
3. Username and password in different forms: do not pair them.
4. `autocomplete="username"` with an opaque/localized label: treat as high confidence.
5. `autocomplete="new-password"` and confirmation field: do not treat as login password.
6. OTP field after the password: never fill it with username or password.
7. Hidden, disabled, and readonly decoy fields: exclude them.
8. Username-only multi-step login page: preserve current semantic matching without requiring a password.
9. Two login forms on one page: pair and fill only the form associated with the initiating field, or the highest-confidence pair when invoked from the toolbar.
10. Cross-origin iframe: do not merge fields with the top-level form; fill only through a frame-local, origin-checked path.

## Bottom line

The public evidence supports the repository's proposed structural fallback, but suggests implementing it as one feature in a scored, form-aware classifier. The smallest robust fix is: **exact autocomplete semantics first; existing keyword signals second; nearest visible editable text-like field before a password in the same form as the fallback; explicit exclusions and a confidence threshold throughout.**

That provides most of the practical benefit visible in 1Password's documented approach without taking on an opaque ML model or copying proprietary code.
