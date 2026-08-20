# Security and privacy

## Data flow

- The plugin starts disabled.
- The default offline glossary performs no network requests.
- The DOM scanner considers only leaf text approved by a compile-time allowlist of known Chinese DSH UI phrases or narrowly bounded numeric pet templates after applying a conservative denylist. It does not read input values, textareas, contenteditable regions, code blocks, composer/editor subtrees, message/session/workspace/search content, or nodes marked `translate="no"` / `.notranslate`.
- Translation caches are bounded and memory-only. They disappear when the page or Host process exits.
- The OpenAI-compatible backend is opt-in. It receives only allowlisted UI phrases in a JSON array; it does not receive HTML, selectors, URLs, session ids, input values, novel user text, or surrounding page context.

## Endpoint controls

- The browser calls only the plugin's same-origin Host route.
- The Host injects an unpredictable per-process token into the served page. Its route accepts JSON POST requests only from a loopback connection with that token, exact same-origin `Origin`/`Host`, and `Sec-Fetch-Site: same-origin`.
- The Host limits request body size, phrase count/length, concurrent requests, and requests per minute before invoking a provider.
- Private and local endpoint names are allowed by default. Public endpoint hosts require an explicit setting and HTTPS.
- URL credentials are rejected. An optional bearer token comes only from a named Host environment variable.
- Provider redirects are rejected.
- Request count, item count, label length, body size, response size, timeout, and caches are bounded.

## Residual risk

DOM classification is conservative but still heuristic. Novel user-controlled text cannot be provider input because it is neither in the compile-time source-phrase allowlist nor one of the digit-only pet count/point templates. A user-controlled value identical to a generic allowlisted label (for example, a session titled `设置`) contains no additional text beyond that public phrase; dynamic-region selectors still exclude known session, workspace, message, and search surfaces. Keep the offline backend unless you understand and accept the configured provider's retention policy.

To prevent translation of a new subtree, mark its root with `translate="no"` or class `notranslate` and report the selector upstream.

## Reporting

Please report vulnerabilities privately to the repository owner before opening a public issue. Do not include secrets, page text, or provider credentials in reports.
