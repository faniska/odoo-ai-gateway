# Changelog

## [0.2.0](https://github.com/faniska/odoo-ai-gateway/compare/v0.1.0...v0.2.0) (2026-10-28)


### Features

* **config:** configure the gateway from environment variables ([8286fd9](https://github.com/faniska/odoo-ai-gateway/commit/8286fd9e2001e0f53e71e9c418e6a2e1f3b62c2e))
* **config:** warn when a config file shadows GATEWAY_* variables ([fcab738](https://github.com/faniska/odoo-ai-gateway/commit/fcab738542b168ce5226bfca7a294aa4bdbfe36e))
* **openrouter:** z.ai web search through web_search_api ([56ab1f0](https://github.com/faniska/odoo-ai-gateway/commit/56ab1f05ea2b18882c89fd39e6e01407fbab721b))


### Bug Fixes

* **config:** tighten environment parsing and its error messages ([bd2407f](https://github.com/faniska/odoo-ai-gateway/commit/bd2407f038235e156a7696c9b0a5f51f32bc12be))

## 0.1.0 (2026-09-30)

### Features

* the JSON-RPC routes of Odoo 20's AI service: completions (async with signed webhook, and sync), embeddings, transcription, realtime session tokens and usage reports
* adapters for OpenAI, Grok, Claude, Gemini and OpenRouter; routing by usage, tier and effort from the config file only
* prompt caching and conversation ids for cache routing across turns
* Docker image and an OpenRouter-only compose example
