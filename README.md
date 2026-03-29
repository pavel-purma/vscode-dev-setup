# Dev Setup — VS Code Extension

**Dev Setup** is a VS Code extension that automatically fetches development-time secrets from [Doppler](https://www.doppler.com/) or [Infisical](https://infisical.com/) and makes them available to your development workflow. It can write secrets to `.env` files, launch scripts with secrets injected as environment variables, or both. It keeps sensitive credentials out of your repository while making them instantly available when you open a project.

## How It Works

1. You place a **configuration file** in your repository (or workspace folder).
2. When VS Code opens the workspace, the extension detects the config, fetches secrets from your provider (Doppler or Infisical), and delivers them based on your configuration — writing a `.env` file, running a script with secrets as environment variables, or both.
3. You can also trigger the fetch manually at any time via the Command Palette.

The extension supports **multi-root workspaces** — each workspace folder is processed independently based on its own configuration file.

## Getting Started

### 1. Install the Extension

Install **Dev Setup** from the VS Code Marketplace or from a `.vsix` package.

### 2. Log In to Your Secrets Provider

Before secrets can be fetched, you need to authenticate with your chosen provider.

#### Doppler

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Dev Setup: Login to Doppler**.
3. The extension will offer to open the Doppler dashboard where you can create a Personal Token.
4. Paste the token when prompted.

The token is validated against the Doppler API and stored securely using VS Code's built-in `SecretStorage`. It is **never** persisted in plaintext.

#### Infisical

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Dev Setup: Login to Infisical**.
3. The extension will offer to open the Infisical dashboard where you can create a Machine Identity with Universal Auth.
4. Enter your Infisical server URL (defaults to `https://app.infisical.com` for Infisical Cloud — change this if you use a self-hosted instance).
5. Paste your **Client ID** and **Client Secret** when prompted.

The credentials are validated by authenticating against the Infisical API and stored securely using VS Code's built-in `SecretStorage`. They are **never** persisted in plaintext.

### 3. Add a Configuration File

Create a configuration file in your project (see [Configuration Files](#configuration-files) below) and commit it to your repository.

### 4. Fetch Secrets

Secrets are fetched **automatically** when the workspace opens. To fetch manually:

1. Open the Command Palette.
2. Run **Dev Setup: Fetch Secrets**.

## Configuration Files

### Supported File Names and Locations

The extension searches for configuration files in the following order (first match wins):

| Priority | Path                   |
|----------|------------------------|
| 1        | `dev/dev-setup.yaml`   |
| 2        | `dev/dev-setup.yml`    |
| 3        | `dev/dev-setup.json`   |
| 4        | `dev-setup.yaml`       |
| 5        | `dev-setup.yml`        |
| 6        | `dev-setup.json`       |

The `dev/` subdirectory is checked first, allowing you to group development-related files together. If no file is found in `dev/`, the workspace root is checked.

Both **YAML** and **JSON** formats are supported. YAML takes priority over JSON within the same directory.

### Configuration Format

#### YAML (`dev-setup.yaml` / `dev-setup.yml`)

```yaml
secrets:
  provider: doppler
  loader: dotenv
  script: npm run dev              # optional
  project: my-doppler-project      # optional
  batches:
    - dev
    - staging
  filter:                          # optional
    include:
      - "^DB_"
    exclude:
      - "_TEMP$"
```

#### JSON (`dev-setup.json`)

```json
{
  "secrets": {
    "provider": "doppler",
    "loader": "dotenv",
    "script": "npm run dev",
    "project": "my-doppler-project",
    "batches": ["dev", "staging"],
    "filter": {
      "include": ["^DB_"],
      "exclude": ["_TEMP$"]
    }
  }
}
```

### Configuration Fields

| Field              | Required | Description |
|--------------------|----------|-------------|
| `secrets.provider` | Yes      | The secrets provider. Supported values: `doppler` and `infisical`. |
| `secrets.loader`   | No*      | How secrets are written locally. Currently only `dotenv` is supported (writes a `.env` file). |
| `secrets.script`   | No*      | A shell command to run in a new VS Code integrated terminal with all fetched secrets injected as environment variables. The terminal's working directory is set to the config file's directory. |
| `secrets.project`  | No       | The project name (Doppler project or Infisical project slug/ID). If omitted, the **workspace folder name** is used as the default. For Infisical, this can be either a human-readable project **slug** or a project **ID** (UUID) — see [Infisical Provider](#infisical-provider). |
| `secrets.batches`  | Yes      | A list of environments/configs to fetch. See [Batch Format](#batch-format). |
| `secrets.filter`   | No       | An object with optional `include` and `exclude` sub-arrays of regex patterns. See [Filtering Secrets](#filtering-secrets). |

> **\*** At least one of `loader` or `script` must be provided. You can use both together — when you do, the loader runs first (e.g., writes the `.env` file), then the script runs in a new terminal.

### Usage Examples

#### Loader Only — Write a `.env` File

The simplest setup: fetch secrets and write them to a `.env` file. Your application reads secrets from the file.

```yaml
secrets:
  provider: doppler
  loader: dotenv
  batches:
    - dev
```

#### Script Only — Run a Dev Server with Secrets

No `.env` file is created. Instead, a new VS Code integrated terminal opens with all fetched secrets set as environment variables, then runs the specified command. This is useful when your tooling reads secrets directly from the environment.

```yaml
secrets:
  provider: doppler
  script: npm run dev
  batches:
    - dev
```

#### Loader and Script — Write `.env` and Run a Script

Combines both approaches: the `.env` file is written first, then the script runs in a terminal with secrets as environment variables. This is handy when you want a persistent `.env` file **and** need to launch a process that uses the secrets.

```yaml
secrets:
  provider: doppler
  loader: dotenv
  script: docker compose up
  batches:
    - dev
```

## Batch Format

Each entry in the `batches` array specifies an environment/config to fetch secrets from. The format varies slightly between providers.

### Doppler Batch Format

#### Simple Format — Config Name Only

```yaml
batches:
  - dev
  - staging
```

When a batch entry contains **no `:`**, it is treated as a Doppler config name. The project is resolved from `secrets.project` (if set) or defaults to the workspace folder name.

For example, in a workspace folder named `my-app` with no explicit `project` field:

- `dev` → Doppler project `my-app`, config `dev`
- `staging` → Doppler project `my-app`, config `staging`

#### Explicit Format — `project:config`

```yaml
batches:
  - my-project:dev
  - shared-infra:production
```

When a batch entry contains a **`:`**, the part before the first `:` is the Doppler project and the part after is the config name. This lets you pull secrets from multiple Doppler projects in a single configuration.

For example:

- `my-project:dev` → Doppler project `my-project`, config `dev`
- `shared-infra:production` → Doppler project `shared-infra`, config `production`

### Infisical Batch Format

For the Infisical provider, batch entries specify an **environment** and optionally a **secret path**. This path support allows a single configuration to pull secrets from multiple folders within the same or different environments — for example, splitting backend and frontend secrets into separate Infisical folders while fetching them all in one go.

If the batch name contains a `/`, the part before the first `/` is treated as the environment name and everything from the first `/` onwards (inclusive) is the secret path.

#### Environment Only

```yaml
batches:
  - dev
  - staging
```

When a batch entry contains **no `/`**, it is the Infisical environment name. The secret path defaults to `/` (or the value of `providerParams.secretPath` if set).

- `dev` → environment `dev`, secret path `/`
- `staging` → environment `staging`, secret path `/`

#### Environment with Path — `environment/path`

```yaml
batches:
  - dev/backend
  - dev/frontend
```

When a batch entry contains a **`/`**, the part before the first `/` is the environment and everything from the first `/` onwards is the secret path. Nested paths are supported.

- `dev/backend` → environment `dev`, secret path `/backend`
- `dev/frontend` → environment `dev`, secret path `/frontend`
- `prod/services/api` → environment `prod`, secret path `/services/api`

This is particularly useful when your Infisical project organises secrets into folders by service or component:

```yaml
secrets:
  provider: infisical
  loader: dotenv
  project: my-platform
  batches:
    - dev/backend
    - dev/frontend
    - dev/shared
```

The above fetches secrets from three different paths within the `dev` environment and merges them into a single `.env` file.

> **Note:** When a per-batch path is specified, it **overrides** any `providerParams.secretPath` set at the configuration level.

#### Explicit Project — `project:environment/path`

```yaml
batches:
  - my-project:dev/backend
  - shared-secrets:prod/services/api
```

When a batch entry contains a **`:`**, the part before the first `:` is the Infisical project and the part after follows the environment/path rules above. The project value can be either a slug or an ID (see [Automatic Project Slug Resolution](#automatic-project-slug-resolution)).

- `my-project:dev` → project `my-project`, environment `dev`, path `/`
- `my-project:dev/backend` → project `my-project`, environment `dev`, path `/backend`
- `shared-secrets:prod/services/api` → project `shared-secrets`, environment `prod`, path `/services/api`

> **Note:** This environment/path syntax is **Infisical-specific** and does not apply to the Doppler provider. For Doppler, the `/` character has no special meaning in batch entries.

### Merging Behaviour

Secrets from all batches are **merged** into a single set. If multiple batches define the same secret key, the **first batch** in the list wins. When using the `dotenv` loader, later duplicates are commented out in the `.env` file.

## Filtering Secrets

The optional `filter` field lets you limit which secrets are delivered to your workflow (written to a `.env` file and/or injected into a script terminal). It is an object with two optional sub-arrays:

| Sub-field | Description |
|-----------|-------------|
| `include` | Array of regex patterns. A secret key must match **all** include patterns to be considered. If omitted, all keys are included by default. |
| `exclude` | Array of regex patterns. A secret key matching **any** exclude pattern is removed. If omitted, nothing is excluded by default. |

If `filter` is absent, all secrets pass through unchanged. When both `include` and `exclude` are present, include is evaluated first, then exclude filters the result.

**Example:** Given the following secrets in Doppler:

- `DB_HOST`
- `DB_TEMP`
- `DB_PORT`
- `API_KEY`

And this configuration:

```yaml
secrets:
  provider: doppler
  loader: dotenv
  batches:
    - dev
  filter:
    include:
      - "^DB_"
    exclude:
      - "_TEMP$"
```

The result:

- `DB_HOST` — **included** (matches include pattern `^DB_`, does not match any exclude pattern)
- `DB_PORT` — **included** (matches include pattern `^DB_`, does not match any exclude pattern)
- `DB_TEMP` — **excluded** (matches include pattern `^DB_`, but also matches exclude pattern `_TEMP$`)
- `API_KEY` — **excluded** (does not match include pattern `^DB_`)

Secrets that are filtered out are logged to the **Dev Setup** output channel for visibility.

## Infisical Provider

This section provides a comprehensive overview of how the extension integrates with [Infisical](https://infisical.com/).

### Authentication

The extension uses Infisical's **Universal Auth** — a machine-identity authentication method based on a Client ID and Client Secret pair. These credentials are obtained by creating a Machine Identity in the Infisical dashboard.

The login flow via **Dev Setup: Login to Infisical** prompts for:

1. **Server URL** — defaults to `https://app.infisical.com` (Infisical Cloud). Change this to your instance URL if you run a self-hosted Infisical server.
2. **Client ID** — the identifier for your Machine Identity.
3. **Client Secret** — the secret key for your Machine Identity.

Both values are validated by performing a real authentication request against the `api/v1/auth/universal-auth/login` endpoint. On success, the credentials (including the server URL) are stored in VS Code's `SecretStorage` — they are **never** written to disk in plaintext.

> **Self-hosted support:** Because the server URL is stored alongside the credentials, the extension works seamlessly with both Infisical Cloud and self-hosted instances. Simply enter your instance URL during the login flow.

### Automatic Project Slug Resolution

The `secrets.project` field (and per-batch project overrides) accepts either a project **slug** (human-readable name) or a project **ID** (UUID).

- **Slug** (e.g., `my-platform`) — the extension queries the Infisical API to list your accessible projects, finds the one whose slug matches, and resolves it to the underlying project ID automatically.
- **ID** (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`) — used directly without an API call.

This means you never need to look up or copy opaque UUIDs. Just use the project slug that is visible in the Infisical dashboard:

```yaml
secrets:
  provider: infisical
  loader: dotenv
  project: my-platform          # project slug — resolved automatically
  batches:
    - dev
```

If the slug cannot be found, the extension shows an error listing all available project slugs so you can correct the value.

### Infisical Configuration Example

A complete Infisical configuration pulling secrets from multiple paths:

```yaml
secrets:
  provider: infisical
  loader: dotenv
  script: npm run dev
  project: my-platform
  batches:
    - dev/backend
    - dev/frontend
    - dev/shared
  filter:
    include:
      - "^API_|^DB_"
    exclude:
      - "_TEMP$"
```

This configuration:

1. Authenticates with Infisical using stored Universal Auth credentials.
2. Resolves the project slug `my-platform` to its project ID.
3. Fetches secrets from three folder paths (`/backend`, `/frontend`, `/shared`) within the `dev` environment.
4. Filters the merged secrets to include only keys starting with `API_` or `DB_`, excluding any ending with `_TEMP`.
5. Writes the result to a `.env` file, then launches `npm run dev` in a terminal with the secrets as environment variables.

## Output

### `.env` File (Loader)

When `loader` is configured, the `.env` file is written in the **same directory** as the configuration file. Secret keys are sorted alphabetically and values are quoted when they contain spaces, special characters, or are empty.

Example output (`.env`):

```dotenv
API_KEY=sk-abc123
DATABASE_URL="postgres://user:pass@host:5432/db"
SECRET_WITH_SPACES="hello world"
```

> **Tip:** Add `.env` to your `.gitignore` to avoid committing secrets.

### Script Terminal

When `script` is configured, a new VS Code integrated terminal is created with the name **Dev Setup**. All fetched secrets are set as environment variables in that terminal, and the specified command is executed automatically. The terminal's working directory is the directory containing the configuration file.

If `loader` is also configured, the `.env` file is written **before** the script terminal is opened.

## Multi-Root Workspaces

In a multi-root workspace, **each workspace folder** is processed independently. If a folder contains a `dev-setup.yaml` (or any of the supported config files), secrets are fetched for that folder using its own configuration.

The default project name for each folder (when `secrets.project` is not specified) is the **folder name** of that workspace root. For Infisical, this default name is used as the project slug and resolved automatically via the API (see [Automatic Project Slug Resolution](#automatic-project-slug-resolution)).

## Commands

| Command                           | Description |
|-----------------------------------|-------------|
| **Dev Setup: Login to Doppler**    | Authenticate with Doppler by providing a Personal Token. The token is validated and stored securely. |
| **Dev Setup: Login to Infisical**  | Authenticate with Infisical by providing Universal Auth credentials (Client ID, Client Secret, and server URL). The credentials are validated and stored securely. |
| **Dev Setup: Fetch Secrets**       | Manually trigger secrets fetching for all workspace folders that have a configuration file. |

## Token Storage & Cross-Environment Access

Provider credentials (Doppler tokens, Infisical Client ID / Client Secret pairs) are stored in **VS Code's SecretStorage** on your local (host) machine — not inside your project, container, or remote environment. This means:

- **One-time setup.** You configure credentials once via the login command for your provider, and they're available everywhere VS Code runs.
- **Works across environments.** Whether you're working in a Dev Container, WSL, or a standard local workspace, they all share the same stored credentials. No need to re-enter them when switching contexts.
- **Nothing stored in the project.** Credentials never appear in your repository, workspace files, or container filesystem. They live at the VS Code installation level on your computer.

In practice, this means you can open the same project in WSL today and in a Dev Container tomorrow without reconfiguring your Doppler or Infisical credentials.

## Troubleshooting

- Open the **Output** panel (`Ctrl+Shift+U` / `Cmd+Shift+U`) and select **Dev Setup** from the dropdown to see detailed logs.
- If no config file is found, the extension silently skips that workspace folder on startup. Use the manual **Fetch Secrets** command to get a warning message.
- If the Doppler token is missing or expired, the extension will prompt you to log in again.
- If Infisical credentials are missing or invalid, the extension will prompt you to run **Dev Setup: Login to Infisical**.
- If an Infisical project slug cannot be resolved, the error message lists all available slugs for your account.

## License

[MIT](LICENSE.md) © Pavel Purma
