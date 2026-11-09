# Contributing to RetroSave

Thanks for your interest in RetroSave. This project is a zero-dependency 1986
cartridge ROM disassembly workbench and deterministic dungeon crawler with
sprite editing and speedrun replay verification, all in pure JavaScript.
Contributions are welcome across the engine, the UI, and the replay verifier.

## Ground rules

- Be respectful and constructive. This project follows the Contributor
  Covenant, found in `CODE_OF_CONDUCT.md`.
- Keep the project dependency free. No `node_modules`, build steps, or runtime
  libraries. Node builtins and the `node:test` runner are fine.
- Keep the game offline. No network requests, no CDN assets, no analytics.
- Determinism is the core contract. The same seed and the same input stream must
  always produce the same run. Never introduce unordered iteration over objects,
  `Math.random`, wall-clock reads, or floating-point paths into the engine.

## Development setup

Requirements:

- Node.js 22 or newer (the test runner is `node --test`)
- A modern browser for manual verification

```sh
git clone https://github.com/draarivpatel-ui/retrosave.git
cd retrosave
node --test
```

To play locally:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How the code is organised

| File | Role |
| --- | --- |
| `game.js` | The dependency-free `Core` namespace: RNG, hashing, collision, sprites, input codecs, and the game simulation |
| `index.html`, `style.css` | The cartridge shell and its styling |
| `test.js` | The test suite, which imports `Core` directly under Node |

`game.js` exports the Core object under Node and only boots the browser game
when a `document` exists, so requiring it in tests is safe. Keep that split: put
pure logic in Core, and keep DOM work behind the browser guard.

## Coding standards

- Use 2-space indentation and single quotes, matching the surrounding file.
- Prefer `const`, and use `let` only when reassignment is required.
- Keep functions small and single purpose. Name them after what they do.
- No comments that restate the code. Comment the reason or the non-obvious
  trade-off.
- Treat em-dashes and en-dashes as a defect in prose and identifiers. Use
  commas, parentheses, or a plain hyphen instead.
- Never swallow errors silently. Fail loudly with an actionable message.
- Any new engine behaviour must be reproducible from a seed, and any new
  simulation rule needs a test that pins the resulting hash or state.

## Changing simulation rules

A change to floor generation, collision, or combat alters replay compatibility.
State that clearly in your pull request, and add a test that pins the new
behaviour with a fixed seed so future regressions are visible.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change with tests. Every bug fix should include a regression test
  that fails before your fix.
3. Run the full suite locally: `node --test`.
4. Update documentation where behaviour changed.
5. Open the PR against `main` with:
   - a short summary of what changed and why,
   - the commands you ran and their result,
   - screenshots for UI changes,
   - a note on replay compatibility if simulation rules changed.
6. Keep the PR small enough to review in one sitting, and respond to review
   promptly.

Commit messages: use a short imperative subject line under 72 characters. Put
the reasoning in the body, not the subject.

## Reporting bugs

Open an issue with the smallest reproduction you can manage: the seed, the
input stream or steps you ran, what you expected, and what happened instead.
Security issues follow `SECURITY.md` instead.
