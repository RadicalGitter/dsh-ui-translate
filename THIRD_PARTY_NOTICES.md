# Third-party notices

`dsh-ui-translate` optionally downloads and runs an open-source Chinese-to-English translation model inside a browser Worker. The model is not bundled in the npm package and is downloaded only after the user explicitly selects the browser-local OPUS-MT backend.

## OPUS-MT Chinese-to-English model

- Original model: [`Helsinki-NLP/opus-mt-zh-en`](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en)
- Developed by: Language Technology Research Group, University of Helsinki
- License: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- Browser-compatible ONNX conversion: [`Xenova/opus-mt-zh-en`](https://huggingface.co/Xenova/opus-mt-zh-en), published by Xenova (Joshua Lochner) for Transformers.js
- Pinned conversion revision: `39d480d52a9ea3065a1f117adfe4dbc55de10e6f`
- Modification disclosure: this plugin does not modify or redistribute the model weights; it downloads the pinned `q8` ONNX conversion from that repository at first use

Required attribution and citation:

> Jörg Tiedemann and Santhosh Thottingal. “OPUS-MT — Building open translation services for the World.” Proceedings of the 22nd Annual Conference of the European Association for Machine Translation (EAMT), 2020.

The model card reports Chinese as the source language, English as the target language, OPUS training data, and known risks involving errors, bias, and stereotypes. Model output is a convenience translation and is not authoritative.

## Transformers.js

- Project: [`huggingface/transformers.js`](https://github.com/huggingface/transformers.js)
- Distributed package: `@huggingface/transformers@3.8.1`
- Copyright: Hugging Face and contributors
- License: [Apache License 2.0](./THIRD_PARTY_LICENSES/Apache-2.0.txt) ([upstream copy](https://github.com/huggingface/transformers.js/blob/v3.8.1/LICENSE))

Transformers.js is bundled only into the dedicated local-model Worker. It loads the pinned model artifacts and performs inference locally.

## Hugging Face Jinja

- Project: [`huggingface/huggingface.js`](https://github.com/huggingface/huggingface.js/tree/main/packages/jinja)
- Bundled package: `@huggingface/jinja@0.5.9`
- Copyright: 2023 Hugging Face
- License: [MIT License](./THIRD_PARTY_LICENSES/Hugging-Face-Jinja-MIT.txt)

The Jinja parser is a transitive Transformers.js dependency included in the Worker bundle.

## ONNX Runtime Web

- Project: [`microsoft/onnxruntime`](https://github.com/microsoft/onnxruntime)
- Bundled package version: `onnxruntime-web@1.22.0-dev.20250409-89f8206ba4`
- Pinned upstream revision: `89f8206ba4`
- Copyright: Microsoft Corporation and contributors
- License: [MIT License](./THIRD_PARTY_LICENSES/ONNX-Runtime-MIT.txt) ([upstream copy](https://github.com/microsoft/onnxruntime/blob/89f8206ba4/LICENSE))
- Required notices: [pinned third-party notices](./THIRD_PARTY_LICENSES/ONNX-Runtime-ThirdPartyNotices.txt) ([upstream copy](https://github.com/microsoft/onnxruntime/blob/89f8206ba4/ThirdPartyNotices.txt)); SHA-256 `e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc`

The WebAssembly runtime files are shipped with this plugin and served from the same DSH origin.
