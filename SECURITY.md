# Security and privacy

## Data flow

- The plugin starts disabled.
- The default offline glossary performs no network requests.
- Network-capable translation considers only leaf text approved by a compile-time allowlist of known Chinese DSH UI phrases or narrowly bounded numeric pet templates after applying conservative dynamic-content exclusions.
- The explicitly selected browser-local OPUS-MT backend processes all visible Chinese text, including messages, session/workspace titles, search results, live status text, plugin content, and other user-authored presentation data. This is intentional and remains browser-local.
- Inputs, active composer/contenteditable regions, code/preformatted text, and explicit `translate="no"` / `.notranslate` subtrees remain excluded to prevent destructive mutation of authored or executable content.
- Translation mutates only individual `Text.data` values. The visual highlight and control box do not wrap React-owned nodes, and canonical IDs, links, attributes, and listeners are not changed.
- Translation caches are bounded and memory-only. Model artifacts use the browser's ordinary Cache API and can be removed through browser site-data controls.
- The browser-local backend downloads only pinned public model artifacts from Hugging Face. Source text and model output remain inside a dedicated same-origin Worker. Disabling, reconfiguring, or unloading terminates active inference.
- The OpenAI-compatible backend is opt-in. It receives only allowlisted UI phrases in a JSON array; it does not receive HTML, selectors, URLs, session ids, input values, novel user text, or surrounding page context.

## Endpoint controls

- The browser-local Worker and ONNX WebAssembly runtime are served from fixed, same-origin, path-allowlisted Host assets. The Worker downloads the model from a fixed repository and immutable revision; settings cannot replace either identifier.
- The browser calls only the plugin's same-origin Host route for the OpenAI-compatible backend.
- The Host injects an unpredictable per-process token into the served page. Its route accepts JSON POST requests only from a loopback connection with that token, exact same-origin `Origin`/`Host`, and `Sec-Fetch-Site: same-origin`.
- The Host limits request body size, phrase count/length, concurrent requests, and requests per minute before invoking a provider.
- Private and local endpoint names are allowed by default. Public endpoint hosts require an explicit setting and HTTPS.
- URL credentials are rejected. An optional bearer token comes only from a named Host environment variable.
- Provider redirects are rejected.
- Request count, item count, label length, body size, response size, timeout, and caches are bounded.

## Residual risk

Remote-provider classification remains conservative: novel user-controlled text cannot be provider input because it is neither in the compile-time source-phrase allowlist nor one of the digit-only templates. Browser-local mode intentionally translates user and session content; any extension or script with access to the same page can already read that DOM, so the plugin's privacy claim is that this text is not sent to a translation server—not that it is hidden from the page itself.

Translated session/workspace names are presentation aliases only. Links and stable IDs remain canonical, so clicking a translated title opens the correct object, but free-text agent commands cannot yet resolve a translated alias back to its source ID. OPUS-MT output can be incorrect, awkward, biased, or offensive and is never authoritative application state. The user can reveal the original or force a re-translation from the visual control box.

To prevent translation of a new subtree, mark its root with `translate="no"` or class `notranslate` and report the selector upstream.

## Reporting

Please report vulnerabilities privately to the repository owner before opening a public issue. Do not include secrets, page text, or provider credentials in reports.
