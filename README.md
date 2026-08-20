# dsh-ui-translate

A privacy-first DeepSeek Harness Web plugin that translates short, static Chinese UI labels without enabling Chrome auto-translate and without rewriting fragile composer or interactive DOM.

## Safety model

The plugin is deliberately conservative:

- disabled on first install;
- defaults to an in-process offline glossary, so no page text leaves the browser;
- considers only connected leaf text that exactly matches a compile-time allowlist of known DSH Chinese UI phrases;
- changes only the `Text.data` value, never element structure, attributes, listeners, or React ownership;
- skips `textarea`, `input`, `select`, `contenteditable`, `code`, `pre`, `[data-input-backdrop]`, forms, live regions, conversation/message regions, composer/editor-related subtrees, `translate="no"`, and `.notranslate`;
- restores translated nodes when disabled or reconfigured;
- keeps bounded in-memory caches in the browser and Host process; page text is not persisted by the plugin.

The selectors and source-phrase allowlist are intentionally biased toward false negatives. Unknown, user-authored, or unsafe text remains Chinese and is never provider input.

## Backends

| Backend | Default | Network behavior |
| --- | --- | --- |
| Offline glossary | Yes | No network. Exact-matches common Chinese labels to English; unknown labels stay unchanged. |
| OpenAI-compatible | No | Sends only allowlisted UI phrases after the user explicitly selects this backend and enables translation. Calls run through a token-authenticated, same-origin, rate-limited, loopback-only Host route. |

The OpenAI-compatible provider defaults to `http://127.0.0.1:11434/v1` and model `qwen2.5:7b`. Loopback, RFC1918, link-local, `.local`, and `host.docker.internal` endpoints are accepted. Public hosts require the explicit **Allow a public endpoint** setting and HTTPS.

An optional bearer token is read by the Host from `DSH_UI_TRANSLATE_API_KEY` (or the composition-only `apiKeyEnv` setting). It is never stored in browser state or sent to the settings UI. Redirects are rejected so credentials are not forwarded to another origin.

Provider code is isolated behind `TranslationProvider` / `TranslationProviderRegistry` on the Host and `ClientTranslationBackend` / `ClientBackendRegistry` in the browser, so more providers can be added without changing the DOM safety engine.

## Install

After npm publication:

```sh
dsh plugin --profile web add dsh-ui-translate
```

From this repository checkout:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-ui-translate
```

Or add the Git repository directly if your DSH profile installer supports Git dependencies:

```sh
dsh plugin --profile web add https://github.com/RadicalGitter/dsh-ui-translate.git
```

Restart `dsh web`, then open **Settings → UI translation**. The plugin stays off until you enable it.

## Configuration

The settings page exposes:

- enable/disable (default: disabled);
- target language (default: English);
- backend (default: offline glossary);
- OpenAI-compatible endpoint, model, and public-endpoint opt-in when that backend is selected.

The same values can be supplied in a later Cordis patch:

```yaml
- id: ui-translate
  config:
    enabled: true
    targetLanguage: en
    backend: openai-compatible
    endpoint: http://127.0.0.1:11434/v1
    model: qwen2.5:7b
    allowRemoteEndpoint: false
    apiKeyEnv: DSH_UI_TRANSLATE_API_KEY
```

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

`cordis.patch.yml` makes this repository a standard DSH profile bundle. The package's `dsh.client` metadata tells the Web client module scanner to serve `lib/client.js`.

## Security and privacy

See [SECURITY.md](SECURITY.md). In brief: installation and the default backend perform no translation requests, browser text is never stored on disk by this plugin, and remote endpoints require an explicit opt-in. Review endpoint ownership and model retention policy before enabling a networked provider.

## License

MIT
