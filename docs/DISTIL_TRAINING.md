# Distil training handoff

The v1 profile freezes ten action tools, two control tools, the exact system prompt and the JSON user context envelope. The runtime accepts argument JSON strings or objects and validates both against the same schema. The training runner is an offline exporter and auditor.

```sh
npm run contracts:check
npm run training:export
npm run training:audit
```

The upload bundle lives in `training/vendor-candidate/` and contains `config.yaml`, `job_description.json`, `train.jsonl` and `test.jsonl`. Train has 300 rows and development has 60. The separate `training/local/holdout.jsonl` has 100 locked cases. Keep the local directory out of any vendor input. Use `training/manifest.json` for SHA-256 values and per-tool denominators.

The bundle follows Distil Labs' documented bundle layout and the `chat-completion` task. The fixed prompt and OpenAI tool definitions are in the job description, and dataset assistant calls carry object arguments. The config uses Qwen3-0.6B, openai.gpt-oss-120b as teacher and judge, student thinking off, rank 16, four SFT epochs, zero RLVR split, and zero generated rows. The documented CLI accepts the four files as one dataset folder and validates on the platform during dataset creation. Cloud could access the official pinned GitHub reference. It could not install the CLI or run the platform validator. Verify installer/version and confirm the provider-side schema before any authorized submission. No uploaded dataset, paid training, or deployment was performed. [Official configuration, task and CLI reference](https://github.com/distil-labs/distil-cli-skill/tree/c012f4daec48e528818adcaa964dfadffa7bc998/skills/distil-cli/references)

Configure the actual endpoint and exact deployed model ID in Settings. To import metadata, paste JSON with `modelId`, `schemaVersion` and `schemaHash` from the exported manifest and configured deployment. Optional fields describe checkpoint SHA-256, origin, revision, variant, supported sampling and thinking. An operator-pinned Ed25519 key enables signed gateway attestation where supported. Unknown and fallback identities stay unverified and out of tuned aggregates. Import base/tuned vendor metrics separately from Arena holdout scores. Use fictional prompts and documents. A provider may log anything sent to its endpoint. [Metadata and signing contract](agent-contract.md) · [Arena guide](model-arena.md)
