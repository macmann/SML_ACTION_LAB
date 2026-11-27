# Model Arena and Distil export

Apply workspace migration 5, then open **Model Arena**. Select routing or generation, configured profiles and cases. Each confirmed batch accepts up to four cases and two profiles. The app caps the batch at eight provider requests and refuses reuse of the batch ID. No case uses workspace documents. Requests share the same input and sampling settings within a comparison. Unsupported provider options can produce a visible failure.

Routing uses the locked v1 prompt, context envelope, ten action schemas and two control schemas. Arena compares the predicted tool and normalized arguments against the label and records schema validity, control behavior, latency and reported token usage. A local document-index fixture checks qualifying search predictions. Cases without an execution fixture are reported as such. Arena never executes against workspace data. The verified tuned aggregate requires a signed compatible gateway response and a tuned profile. Unverified and fallback responses remain visible with their attribution. Vendor aggregate metrics can be entered as separately labeled base or tuned results, with their source and sample size.

Generation cases use separate fictional summary and email prompts. Select the configured writer, comparison provider or SLM explicitly. Review the draft against the supplied source and record a human faithfulness score and notes. The app does not send drafts. The Arena provides JSON and CSV exports with denominators and failures.

## Dataset and audit

```sh
npm run training:export
npm run training:audit
```

The exporter produces 300 training and 60 development examples in `training/vendor-candidate`, with development named `test.jsonl`. The 100 final examples live in `training/local/holdout.jsonl` outside the vendor directory and are locked by SHA-256. Keep the final examples out of vendor uploads. The manifest records counts, checksums and the frozen schema hash. The audit checks native tool argument objects, schema parity, control coverage, unique normalized requests, disjoint scenario groups and lexical overlap across splits. Semantic equivalence still requires human review.

The candidate export specifies chat completion, Qwen3-0.6B, openai.gpt-oss-120b teacher and judge, thinking disabled, LoRA rank 16, four SFT epochs, and RLVR disabled. Current Distil documentation and a matching CLI could not be verified in Cloud. Treat `config.yaml`, `job_description.json` and the JSONL layout as candidates until validated against the vendor's current documentation and CLI. No jobs were submitted.
