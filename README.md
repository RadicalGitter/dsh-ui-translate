# dsh-ui-translate

A privacy-first DeepSeek Harness Web plugin that translates safe, short Chinese UI text without enabling Chrome auto-translate and without rewriting fragile composer or user-content DOM.

## Safety model

The plugin is deliberately conservative:

- disabled on first install;
- defaults to an in-process offline glossary, so no page text leaves the browser;
- for network-capable translation, considers only connected leaf text approved by a compile-time allowlist of known DSH Chinese UI phrases and narrowly bounded numeric pet templates;
- for the explicitly selected browser-local model, may translate other short Chinese leaf copy only inside positively identified static surfaces (currently pet whispers/feedback or an explicit `data-dsh-translate="static"` owner marker), while still excluding user/session/workspace/search/message/composer surfaces and keeping all inference inside a dedicated Worker;
- changes only the `Text.data` value, never element structure, attributes, listeners, or React ownership;
- skips `textarea`, `input`, `select`, `contenteditable`, `code`, `pre`, `[data-input-backdrop]`, forms, conversation/message regions, composer/editor-related subtrees, `translate="no"`, `.notranslate`, and all live regions except positively identified local pet whispers;
- restores translated nodes when disabled or reconfigured;
- keeps bounded in-memory caches in the browser and Host process; page text is not persisted by the plugin.

The selectors and source-phrase allowlist are intentionally biased toward false negatives. Unknown, user-authored, or unsafe text remains Chinese and is never provider input.

## Backends

| Backend | Default | Network behavior |
| --- | --- | --- |
| Offline glossary | Yes | No network. Translates approved Chinese labels and bounded pet count/point templates to English; unknown labels stay unchanged. |
| Browser-local OPUS-MT | No | Chinese-to-English only. On first use, downloads about 110 MB of pinned quantized model files from Hugging Face, caches them in the browser, and performs inference inside a dedicated local Worker. UI text is not uploaded. |
| OpenAI-compatible | No | Sends only allowlisted UI phrases after the user explicitly selects this backend and enables translation. Calls run through a token-authenticated, same-origin, rate-limited, loopback-only Host route. |

The browser-local backend uses `Xenova/opus-mt-zh-en` pinned to revision `39d480d52a9ea3065a1f117adfe4dbc55de10e6f`. Selecting it is explicit consent to download public model artifacts from Hugging Face. The model files are the only remote payload in this mode: source UI text and translations stay inside the browser Worker. Cancelling, disabling, reconfiguring, or unloading the plugin terminates active inference.

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
- backend (default: offline glossary), including the opt-in browser-local OPUS-MT engine;
- local-model download/initialization status when OPUS-MT is selected;
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

## Open-source model and runtime attribution

The optional browser-local backend builds on these open-source projects:

- [`Helsinki-NLP/opus-mt-zh-en`](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en), developed by the Language Technology Research Group at the University of Helsinki and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
- [`Xenova/opus-mt-zh-en`](https://huggingface.co/Xenova/opus-mt-zh-en), the browser-compatible ONNX conversion published by Xenova (Joshua Lochner) and used at the pinned revision listed above;
- [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) 3.8.1, licensed under Apache-2.0;
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), licensed under MIT.

Please see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for the full attribution, model citation, revision, license links, and limitations.

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
