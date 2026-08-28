# Bitwarden field detection: public implementation and reusable patterns

Date: 2026-08-28

## Question and scope

This note investigates how Bitwarden's browser extension finds and fills login fields, especially a localized or opaque username field such as `用户名称*`, and compares that implementation with this repository and the earlier [1Password research](./1password-field-detection.md).

The implementation evidence is pinned to Bitwarden `clients` commit [`2786ce70db981a074b9dd3341f2d9d5a49fd8801`](https://github.com/bitwarden/clients/tree/2786ce70db981a074b9dd3341f2d9d5a49fd8801), dated 2026-08-28. Bitwarden's default source license is GPL-3.0 unless a file says otherwise; its separately licensed code is confined to `/bitwarden_license` ([license notice](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/LICENSE.txt)). This repository declares AGPL-3.0-or-later. The recommendations below borrow architecture and behavior, not pasted implementation.

## Bottom line

Bitwarden's public code directly confirms the structural solution proposed for this repository. For every candidate password field, Bitwarden considers only earlier `text`, `email`, or `tel` fields; prefers a qualifying field in the same non-null form; returns a same-form field with a username keyword immediately; and otherwise returns the **last eligible same-form field encountered**, which is effectively the nearest eligible field before the password in DOM order. The fallback does not require the field's label to be in a recognized language ([`findUsernameField`](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L2973-L3035)).

Therefore, a visible editable field like this:

```html
<form>
  <label>用户名称*</label>
  <input type="text" id="opaque-1">
  <input type="password" id="opaque-2">
</form>
```

is a username candidate in Bitwarden even though `用户名称*` is absent from its English/German username dictionary. This conclusion is a direct application of the published algorithm, not evidence from running the proprietary store build against the recorded site.

## Confirmed implementation facts

### 1. Username/password pairing is structural and deterministic

Bitwarden starts from password fields, then calls `findUsernameField()` for each chosen password. The login generator prefers login-password fields over registration-password fields and carries any focused field into the pairing decision ([login fill generation](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L1155-L1278)).

`findUsernameField()` applies these rules ([source](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L2973-L3035), [tests](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.spec.ts#L5360-L5575)):

1. Ignore fields after the password (`elementNumber` must be lower).
2. Ignore custom `span` fields and fields disqualified as non-login context.
3. Only consider `text`, `email`, or `tel` fields.
4. Require an editable field: not disabled and, in the normal path, not readonly.
5. Normally require visibility. A same-form `email` or `tel` field is treated as strong enough to survive an unreliable visibility result.
6. Normally require the same non-null form, except looser fallback paths for pages with missing form metadata or a keyword-qualified field.
7. Return a same-form field with a username keyword as soon as it is encountered.
8. If no keyword-qualified same-form field exists, return the final eligible same-form field seen before the password—the nearest preceding candidate in normal DOM order.

This is **precedence**, not numerical confidence scoring. There are named positive and negative features, but no general score or threshold in the login username selector.

For pages with no password, Bitwarden does not use the structural fallback. It requires a visible `text`/`email`/`tel` field to match the username keyword list and not be classified as non-login context ([username-only path](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L1337-L1378)). This distinction limits false positives on ordinary email/newsletter forms.

### 2. Keywords are secondary for paired forms, but still broad signals

Bitwarden's username dictionary is mostly English plus German and includes `username`, `user id`, `customer id`, `login`, email variants, and German equivalents ([constants](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill-constants.ts#L63-L92)). It does **not** include Chinese username words in the reviewed revision.

Field keywords are built from `id`, `name`, class, type, title, placeholder, autocomplete, dataset values, several label positions, ARIA label, and `aria-describedby`. Values are Unicode-tokenized, normalized, cached, and normally substring-matched ([qualification utility](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/utils/qualification.ts#L23-L103)).

Negative context is explicit. The collector excludes common non-login input types, while login selection excludes disabled/readonly fields and recognized TOTP, captcha, search, new-password, registration, and strong non-login/newsletter contexts through separate checks ([candidate collection](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L82-L167), [login constants](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill-constants.ts#L94-L236), [non-login qualification](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/utils/qualification.ts#L212-L290)).

### 3. `autocomplete` is used, but not as one universal high-confidence classifier

The collector records `autocomplete`, `x-autocompletetype`, or `autocompletetype` in `autoCompleteType` ([collector](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L848-L967)). That value participates in the general username keyword set, so `autocomplete="username"` supplies a username keyword.

Password selection is more exact: Bitwarden parses space-separated autocomplete tokens case-insensitively, distinguishes `current-password` from `new-password`, excludes `new-password` during ordinary login filling, and on multi-password forms can keep only a declared current-password field ([password selection](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L2815-L2929), [token parser](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L3233-L3253), [tests](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.spec.ts#L4981-L5009)). `one-time-code` is likewise an explicit TOTP signal in the login generator.

### 4. Form ownership, DOM order, focus, and context all matter

The collector assigns every field an `elementNumber` in collection order and its owning form's synthetic ID. It also captures native/associated/wrapping labels, nearby left/right text, table headings, placeholders, ARIA metadata, dataset text, editability, and visibility ([field collection](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L754-L930), [label extraction](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L1006-L1210)).

For inline-menu interactions, Bitwarden records the most recently focused field's opid and form. The background passes these into autofill; the fill service restricts candidates to the focused form and directly treats a focused `text`/`email`/`tel` control as the username unless it looks like TOTP ([focus capture](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill-overlay-content.service.ts#L1032-L1110), [focus-aware pairing](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L1181-L1249)). This is contextual focus handling, not an unconditional read of `document.activeElement` during every toolbar/page-load fill.

### 5. Visibility checking is substantially stronger than a width/intersection test

Bitwarden records whether a field is inside page bounds, at least 10×10 pixels, visible by computed `opacity`, `display`, `visibility`, and known hiding `clip-path` values, and not covered at its center by another element (except its own label or Bitwarden's inline UI). Parent opacity is also checked ([visibility service](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/dom-element-visibility.service.ts#L13-L186)).

Visibility remains distinct from semantic classification: the collector stores `viewable`, and the selector separately decides whether a hidden candidate is permissible. This separation is useful because UI overlays and credential filling can have different visibility policies.

### 6. Dynamic pages are monitored and recollected

The content collector installs a `MutationObserver` for child-list changes and a defined set of autofill-relevant attributes, uses an `IntersectionObserver` for initially non-viewable fields, caches collected metadata, invalidates/rebuilds it after relevant mutations, and explicitly traverses shadow DOM ([collector lifecycle](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L45-L218), [collection/cache path](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L280-L319), [mutation handling](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L1482-L1595)). The official design notes also describe a delayed retry when a matching page has not yet rendered a fillable field ([fill mechanics](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/autofill.design.md#retry-classification)).

### 7. Frames are analyzed independently and guarded by origin/URI matching

Bitwarden collects page details from each frame and sends each fill script back to the corresponding `frameId` ([frame collection and dispatch](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L122-L168), [dispatch](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L501-L565)). It does not merge a child frame's inputs directly into the parent document.

A frame is considered untrusted when its URL differs from the top-level tab URL and does not match a saved login URI under the configured URI-match policy. Page-load autofill refuses such a frame; a manual fill reaches a confirmation prompt ([trust classifier](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L1669-L1698), [content-side guard](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/insert-autofill-content.service.ts#L28-L123)). Bitwarden's official help states the same policy: [Autofill in iframes](https://bitwarden.com/help/auto-fill-browser/#autofill-in-iframes).

### 8. Fill events are simulated, but success is not value-verified end to end

Each field gets click/focus, keyboard events before and after assignment, then bubbling `input` and `change` events. Bitwarden restores the original value if pre-insert handlers changed it and restores the intended filled value if post-assignment keyboard handlers changed it ([insert service](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/insert-autofill-content.service.ts#L172-L321)). It skips missing, already-correct, readonly, and disabled targets.

However, `didAutofill` means that a non-empty fill script was **dispatched** to at least one frame, not that the content script read every value back and acknowledged success ([result contract](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/abstractions/autofill.service.ts#L20-L40), [dispatch point](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/autofill.service.ts#L531-L565)). `input`/`change` handlers could still clear or transform a value after the last internal restoration. Bitwarden therefore has robust event compatibility, but its public code does not establish end-to-end post-fill verification per field.

### 9. Hard sites can bypass heuristics through two explicit mechanisms

Bitwarden supports linked custom fields that map a saved username or password to an element's `id`, `name`, `aria-label`, or placeholder ([official custom-field documentation](https://bitwarden.com/help/auto-fill-custom-fields/#using-linked-custom-fields)).

Since browser extension 2026.6.0, optional **Fill Assist** can replace normal heuristics on curated problem sites with human-authored, reviewed CSS-selector maps. Maps are refreshed on sync or every six hours and stored locally ([official Fill Assist documentation](https://bitwarden.com/help/fill-assist/), [targeted collection implementation](https://github.com/bitwarden/clients/blob/2786ce70db981a074b9dd3341f2d9d5a49fd8801/apps/browser/src/autofill/services/collect-autofill-content.service.ts#L280-L420)). This is a site-specific escape hatch, not part of the generic localized-field solution.

## Feature checklist

| Question | Bitwarden answer | Evidence level |
| --- | --- | --- |
| Exact autocomplete tokens? | Yes for current/new password and TOTP; username autocomplete also feeds the keyword classifier. | Confirmed in source and tests. |
| Form and DOM position? | Yes. Password-first pairing; username must precede the password; same non-null form is preferred; the final same-form fallback is nearest in normal order. | Confirmed in source and tests. |
| Labels and attributes? | Yes: ID/name/class/type/title/placeholder/autocomplete/dataset, native and inferred labels, nearby text, ARIA label and description. | Confirmed in source. |
| Visibility checks? | Yes: geometry, bounds, CSS, parent opacity, occlusion, plus editability checks in selection/fill. | Confirmed in source and tests. |
| Active/focused field? | Yes for inline-menu/focused flows; it scopes the form and can be the username candidate directly. | Confirmed in source. |
| Scoring? | No general numeric scorer for login username selection; deterministic precedence and fallbacks. | Confirmed absence in the reviewed selector; do not generalize to every Bitwarden subsystem. |
| Iframe handling? | Per-frame collection/fill plus URI-match trust policy; page-load blocked for untrusted frames and manual fill warned. | Confirmed in source and official docs. |
| Mutation observer? | Yes, along with intersection observation, caching, shadow-DOM traversal, and delayed retry. | Confirmed in source/design docs. |
| Fill events? | Yes: click, focus, keydown/up, assignment, keydown/up, input, change. | Confirmed in source and tests. |
| Post-fill verification? | Partial local restoration around simulated keyboard handlers, but no per-field acknowledgment/readback to the background; “success” means dispatched. | Confirmed from the public result contract and insertion flow. |

## Comparison with this repository and 1Password

| Concern | Current `browser-autofill` | Bitwarden public implementation | 1Password public evidence |
| --- | --- | --- | --- |
| Localized opaque username before password | Fails unless an English/German-like substring appears in field metadata (`PageAnalyser.ts:91-116`). Username and password lists are built independently. | Succeeds through same-form, preceding-field fallback without translating the label. | Public implementation unavailable; official releases confirm ML classification and broader language support, while developer guidance confirms structural metadata matters. |
| Pairing | First independently detected username and first password are filled (`AutoFiller.ts:10-55`). | Password-first pairing using DOM order, form ownership, focus, type, editability, visibility, positive keywords, and negative context. | Recommended same-form structure is confirmed; exact weights are not public. |
| Classifier shape | Boolean keyword test plus a separate search exclusion. | Deterministic precedence/fallbacks, not numeric scoring. | Public releases describe a classifier/ML system; exact model is private. |
| Username-only pages | Existing keyword matcher can work; opaque/localized fields fail. | Deliberately requires keyword evidence when there is no password, reducing newsletter/search false positives. | Release notes confirm support for username-only fields, exact rules unknown. |
| Visibility | Width over 50 and viewport intersection; a more complete `isInputVisible` helper exists but is not in the collection path (`PageAnalyser.ts:23-84,232-280`). | Geometry, CSS, ancestor opacity, occlusion, intersection refresh; disabled/readonly checked separately. | Public security documentation confirms multiple hidden-field checks, details private. |
| Frames | Parent attempts direct iframe DOM access and appends accessible inputs (`PageAnalyser.ts:30-45`). | Frame-local collection and fill, addressed by frame ID, with URI-match trust checks. | Public docs confirm iframe-origin gating. |
| Dynamic fields | Each call rescans, with no persistent mutation-driven model in these two files. | Mutation observer, cache invalidation, shadow-DOM traversal, visibility refresh, and retry. | Public compatibility guidance asks sites to avoid unstable dynamic fields; internals private. |
| Fill result | `true` means either username or password loop ran (`AutoFiller.ts:13-55`). | `didAutofill` means a fill script was dispatched, also not a per-part verification result. | Public result contract unavailable. |
| Events | Click/focus, keydown/keypress/keyup, assignment, keyboard events, input/change, blur, then a final local value restoration (`AutoFiller.ts:81-123`). | Similar, without `keypress`/final blur; also skips readonly/disabled/already-correct values and uses staged actions. | Exact event sequence unavailable publicly. |

Bitwarden gives stronger direct support than 1Password for the immediate structural fix because the relevant selector is open source. The earlier 1Password recommendation proposed a numeric confidence model; Bitwarden shows that a smaller deterministic hierarchy can solve this specific failure safely enough when paired with same-form, pre-password, visibility/editability, focus, and negative-context constraints.

## Recommended borrowing order

### Immediate fix

Implement a small, independently written Bitwarden-style paired selector in `PageAnalyser.ts`:

1. Collect visible fields once so username and password decisions share one ordered snapshot.
2. Choose login-password candidates first. Recognize `current-password`; exclude `new-password`, OTP-like, disabled, and readonly fields.
3. For each selected password, inspect only preceding `text`, `email`, or `tel` fields.
4. Prefer the active/initiating text-like field when it belongs to the password's form.
5. Otherwise prefer an explicit username signal in the same form (`autocomplete` token first, then the existing semantic matcher).
6. Otherwise choose the nearest visible editable text-like field before the password in the same non-null form.
7. Keep the current keyword-only logic for username-only/multi-step pages; do not apply the opaque-field fallback when no password supplies structural context.

This directly fixes the recorded Chinese-label case and is simpler than adding translations or a general scoring framework.

### Safeguards to include in the same change

- Exclude search, one-time-code/TOTP, new-password, disabled, readonly, and hidden candidates.
- Pair by actual `input.form` ownership, not merely the nearest field anywhere on the page.
- If the initiating field is available, restrict filling to its form/context.
- Return a structured result such as `{ usernameFilled, passwordFilled }`; neither this repository's current Boolean nor Bitwarden's dispatch Boolean can distinguish a complete login fill from password-only completion.
- Add regression tests for an opaque Chinese username label, multiple forms, a search field before login, OTP/new-password fields, disabled/readonly decoys, and username-only pages.

### Follow-up hardening

- Improve visibility by using the existing rendered-visibility checks as part of collection, then add disabled/readonly and, if needed, occlusion checks.
- Analyze frames in their own content-script context and require the frame origin/URL to match the credential before filling; do not merge iframe fields into the parent list.
- Add mutation-driven invalidation or a short retry only if dynamic-login pages are an observed problem; it is not required to fix the recorded static field-classification failure.
- Consider a site-specific selector override only if generic heuristics still fail on a small set of important sites. Bitwarden's Fill Assist validates the escape-hatch pattern, but building a remote curated map is much larger in scope than this bug.

## Confirmed facts versus inference

**Confirmed:** Bitwarden's reviewed source uses password-first, same-form, preceding-field username pairing; records rich metadata; uses focus context; checks visibility/editability; observes DOM mutations; handles frames independently with a URI-match trust policy; dispatches simulated user events; and exposes manual/site-specific overrides.

**Inference for the recorded page:** assuming the visible username input and password input are in the same form and the username occurs first in collection/DOM order, Bitwarden's published default heuristic would choose it even with the label `用户名称*`. The recording alone does not prove those exact DOM conditions, so an implementation regression fixture should reproduce them from inspected markup if available.

**Not confirmed:** that Bitwarden uses machine learning for this selector, assigns numeric weights, understands the Chinese label semantically, always verifies final field values, or would fill every variation of the recorded site. None of those claims are supported by the reviewed public source.
