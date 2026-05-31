# Security Policy

## Supported Version

Security hardening targets `1.0.0-rc.1`. Older beta versions used shell-first command execution and should not run untrusted command strings.

## Command Execution Model

`runCommand` defaults to safe mode. Safe mode uses `spawn` without a shell, validates cwd containment, rejects shell syntax, blocks shell wrappers, blocks inline interpreters, applies a default allowlist and redacts common secrets from summaries/artifacts.

Safe mode still executes local programs. Do not add broad allowlist entries such as `/.*/`, `node .*`, `powershell .*`, or `bash .*`.

Safe mode is default-deny. It blocks shell metacharacters, destructive commands, shell wrappers, inline interpreters, network installers, SSH/SCP, environment dumps, secret-file reads, cwd escapes, oversized command lines and excessive argument counts.

The runner enforces `timeoutMs`, `maxStdoutBytes`, `maxStderrBytes`, `maxLines`, `maxArtifactBytes`, `maxCommandLength`, `maxArgs` and `maxArgLength`. These limits reduce accidental context explosions; they do not prove that a permitted local command is harmless.

Safe mode uses a minimal environment. It does not pass the full parent `process.env`; callers must provide extra variables through `safeEnv` or `allowedEnv`.

Unsafe mode exists only for trusted local automation:

```bash
token-optimizer exec "your command" --unsafe
```

Review unsafe commands before running them.

## Filesystem Boundaries

The runtime resolves paths with `realpath`, verifies containment with `path.relative`, rejects symlink escapes and skips common secret, binary, cache, build, lockfile and dependency paths during indexing. Command artifacts are written only under `.token-optimizer/artifacts`.

Artifact paths returned by the API are repo-relative. The implementation writes artifacts through the cache store under the optimizer state directory.

`readFileContext` uses the same exclusion policy as indexing, so `.env`, `.npmrc`, `.pypirc`, private keys, credentials and secret files are rejected before content is read into the response.

## Reporting Issues

Open a GitHub issue with:

- A minimal reproduction.
- The command or path input.
- Expected behavior.
- Actual behavior.
- Whether safe mode or unsafe mode was used.

Do not include real secrets in reports. Replace tokens, keys and private paths with placeholders.
