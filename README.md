# dsh-ui-translate

A privacy-first DeepSeek Harness Web plugin that can translate all visible Chinese UI and content—including session titles, workspace names, messages, search results, and plugin text—without enabling Chrome auto-translate.

## Privacy and mutation model

- The plugin is disabled on first install and defaults to the in-process offline glossary.
- Network-capable translation remains restricted to a compile-time allowlist of known DSH UI phrases and bounded numeric templates.
- The explicitly selected browser-local OPUS-MT backend translates all connected visible Chinese text, including user-authored and session-derived content. Source text and translations stay inside a dedicated browser Worker and are never uploaded.
- Editable/composer fields, `textarea`, `input`, `select`, `contenteditable`, code/preformatted content, `[data-input-backdrop]`, `translate="no"`, and `.notranslate` remain untouched to avoid corrupting authored or executable text. A plugin may explicitly mark a read-only `<pre>` as prose with `data-dsh-translate="prose"`; only the browser-local backend may translate that opt-in surface.
- Translation changes only `Text.data`; element structure, attributes, stable session/workspace IDs, links, listeners, and React ownership remain intact.
- Translated text receives a configurable marker: purple overlay (default), dashed underline, both, or none. Hovering directly over translated characters for about 0.65 seconds exposes exactly one contextual action: **Show original** while translated, then **Re-translate** after the original is shown. The control does not wrap or intercept the underlying link.
- Translated session titles are presentation aliases: clicking them still opens the canonical thread through its unchanged ID/link. Free-text alias resolution by an agent is not yet provided.
- Disabling or reconfiguring the plugin restores original text. Translation-result caches are bounded and memory-only; downloaded model assets use the browser cache.
- Local inference runs progressively in small sequential batches: visible navigation, settings, and live-status text are prioritized ahead of conversation backlogs, and scrolling queues newly visible content.

## Backends

| Backend | Default | Network behavior |
| --- | --- | --- |
| Offline glossary | Yes | No network. Translates approved Chinese labels and bounded pet count/point templates to English; unknown labels stay unchanged. |
| Browser-local OPUS-MT | No | Chinese-to-English only. Translates all visible Chinese UI and content. On first use, downloads about 110 MB of pinned quantized model files from Hugging Face, caches them in the browser, and performs inference inside a dedicated local Worker. Page text is not uploaded. |
| OpenAI-compatible | No | Sends only allowlisted UI phrases after the user explicitly selects this backend and enables translation. Calls run through a token-authenticated, same-origin, rate-limited, loopback-only Host route. |

The browser-local backend uses `Xenova/opus-mt-zh-en` pinned to revision `39d480d52a9ea3065a1f117adfe4dbc55de10e6f`. Selecting it is explicit consent to download public model artifacts from Hugging Face. The model files are the only remote payload in this mode: source UI text and translations stay inside the browser Worker. Long messages are segmented into bounded sentences/chunks and reconstructed locally. Cancelling, disabling, reconfiguring, or unloading the plugin terminates active inference. This compact local model can produce literal or awkward translations; pathological blank, excessively long, and repeated-punctuation output is discarded or normalized before it reaches the page.

Translated text is visually marked through the browser Custom Highlight API, with plugin-owned range overlays where that API is unavailable. The floating control box lives outside React-owned content, requires a deliberate text hover, and shows one action at a time: reveal the original, then invalidate the local result cache and re-translate it.

The OpenAI-compatible provider defaults to `http://127.0.0.1:11434/v1` and model `qwen2.5:7b`. Loopback, RFC1918, link-local, `.local`, and `host.docker.internal` endpoints are accepted. Public hosts require the explicit **Allow a public endpoint** setting and HTTPS.

An optional bearer token is read by the Host from `DSH_UI_TRANSLATE_API_KEY` (or the composition-only `apiKeyEnv` setting). It is never stored in browser state or sent to the settings UI. Redirects are rejected so credentials are not forwarded to another origin.

Provider code is isolated behind `TranslationProvider` / `TranslationProviderRegistry` on the Host and `ClientTranslationBackend` / `ClientBackendRegistry` in the browser. Browser-local models resolve through a compile-time vetted language-pair catalog that pins the model, revision, license metadata, source matcher, and target joining strategy; configuration cannot supply arbitrary model asset URLs.

### Integrating readable plugin content

Dynamically mounted plugin text needs no API call: the document observer discovers ordinary visible text automatically. Verbatim elements remain protected because a generic translator cannot know whether `<pre>` contains prose, JSON, tool arguments, or executable code. A plugin that renders trustworthy read-only prose—such as an injected `AGENTS.md`, a context summary, or a tool description—can opt in on that exact element:

```html
<pre data-dsh-translate="prose">可供用户阅读的注入上下文</pre>
```

Do not put the attribute on JSON schemas, tool arguments, source code, terminal output, or an ancestor that also contains those surfaces. The attribute is intentionally inert when the offline glossary or a network-capable backend is selected, so arbitrary injected context cannot cross the Host privacy boundary.

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
- translation marker style: purple overlay (default), dashed underline, both, or none;
- delayed-hover per-text original/re-translate controls for translated content;
- OpenAI-compatible endpoint, model, and public-endpoint opt-in when that backend is selected.

The same values can be supplied in a later Cordis patch:

```yaml
- id: ui-translate
  config:
    enabled: true
    sourceLanguage: zh
    targetLanguage: en
    backend: openai-compatible
    markerStyle: overlay
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
