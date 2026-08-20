# Security and privacy

## Data flow

- The plugin starts disabled.
- The default offline glossary performs no network requests.
- Network-capable translation considers only leaf text approved by a compile-time allowlist of known Chinese DSH UI phrases or narrowly bounded numeric pet templates after applying conservative dynamic-content exclusions.
- The explicitly selected browser-local OPUS-MT backend may process other short Chinese leaf copy only inside positively owned static surfaces (pet whisper/feedback classes or an explicit `data-dsh-translate="static"` marker). Inputs, contenteditable regions, code, composer/editor subtrees, message/session/workspace/search content, clickable pet session bubbles, ordinary live status bubbles, custom pet names, and nodes marked `translate="no"` / `.notranslate` remain excluded.
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

DOM classification is conservative but still partly heuristic. Novel user-controlled text cannot be remote-provider input because it is neither in the compile-time source-phrase allowlist nor one of the digit-only pet count/point templates. The browser-local model accepts broader copy only inside positively identified static owners; a future component that incorrectly marks a user-content root as `data-dsh-translate="static"` could cause local-only presentation translation, but that text is not uploaded and disabling the plugin restores the original nodes. Known session, workspace, message, search, composer, custom pet-name, ordinary status, and clickable pet-session surfaces are explicitly excluded.

OPUS-MT output can be incorrect, awkward, biased, or offensive and is presentation-only, never authoritative application state. Keep the offline glossary unless you accept the model download and these quality limitations; keep the OpenAI-compatible backend disabled unless you understand the configured provider's retention policy.

To prevent translation of a new subtree, mark its root with `translate="no"` or class `notranslate` and report the selector upstream.

## Reporting

Please report vulnerabilities privately to the repository owner before opening a public issue. Do not include secrets, page text, or provider credentials in reports.
