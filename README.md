# Dev Setup — VS Code Extension

**Dev Setup** is a VS Code extension that automatically fetches development-time secrets from [Doppler](https://www.doppler.com/) and writes them into `.env` files. It keeps sensitive credentials out of your repository while making them instantly available when you open a project.

## How It Works

1. You place a **configuration file** in your repository (or workspace folder).
2. When VS Code opens the workspace, the extension detects the config, fetches secrets from Doppler, and writes them to a `.env` file next to the config.
3. You can also trigger the fetch manually at any time via the Command Palette.

The extension supports **multi-root workspaces** — each workspace folder is processed independently based on its own configuration file.

## Getting Started

### 1. Install the Extension

Install **Dev Setup** from the VS Code Marketplace or from a `.vsix` package.

### 2. Log In to Doppler

Before secrets can be fetched, you need to provide a Doppler Personal Token:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Dev Setup: Login to Doppler**.
3. The extension will offer to open the Doppler dashboard where you can create a Personal Token.
4. Paste the token when prompted.

The token is validated against the Doppler API and stored securely using VS Code's built-in `SecretStorage`. It is **never** persisted in plaintext.

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
  project: my-doppler-project    # optional
  batches:
    - dev
    - staging
  filter:                        # optional
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
| `secrets.provider` | Yes      | The secrets provider. Currently only `doppler` is supported. |
| `secrets.loader`   | Yes      | How secrets are written locally. Currently only `dotenv` is supported (writes a `.env` file). |
| `secrets.project`  | No       | The Doppler project name. If omitted, the **workspace folder name** is used as the default project name. |
| `secrets.batches`  | Yes      | A list of Doppler configs (environments) to fetch. See [Batch Format](#batch-format). |
| `secrets.filter`   | No       | An object with optional `include` and `exclude` sub-arrays of regex patterns. See [Filtering Secrets](#filtering-secrets). |

## Batch Format

Each entry in the `batches` array specifies a Doppler **config** (environment) to fetch secrets from. There are two formats:

### Simple Format — Config Name Only

```yaml
batches:
  - dev
  - staging
```

When a batch entry contains **no `:`**, it is treated as a Doppler config name. The project is resolved from `secrets.project` (if set) or defaults to the workspace folder name.

For example, in a workspace folder named `my-app` with no explicit `project` field:

- `dev` → Doppler project `my-app`, config `dev`
- `staging` → Doppler project `my-app`, config `staging`

### Explicit Format — `project:config`

```yaml
batches:
  - my-project:dev
  - shared-infra:production
```

When a batch entry contains a **`:`**, the part before the first `:` is the Doppler project and the part after is the config name. This lets you pull secrets from multiple Doppler projects in a single configuration.

For example:
- `my-project:dev` → Doppler project `my-project`, config `dev`
- `shared-infra:production` → Doppler project `shared-infra`, config `production`

### Merging Behaviour

Secrets from all batches are **merged** into a single `.env` file. If multiple batches define the same secret key, the **first batch** in the list wins — later duplicates are commented out.

## Filtering Secrets

The optional `filter` field lets you limit which secrets are written to the `.env` file. It is an object with two optional sub-arrays:

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

## Output

The `.env` file is written in the **same directory** as the configuration file. Secret keys are sorted alphabetically and values are quoted when they contain spaces, special characters, or are empty.

Example output (`.env`):

```dotenv
API_KEY=sk-abc123
DATABASE_URL="postgres://user:pass@host:5432/db"
SECRET_WITH_SPACES="hello world"
```

> **Tip:** Add `.env` to your `.gitignore` to avoid committing secrets.

## Multi-Root Workspaces

In a multi-root workspace, **each workspace folder** is processed independently. If a folder contains a `dev-setup.yaml` (or any of the supported config files), secrets are fetched for that folder using its own configuration.

The default Doppler project name for each folder (when `secrets.project` is not specified) is the **folder name** of that workspace root.

## Commands

| Command                        | Description |
|--------------------------------|-------------|
| **Dev Setup: Login to Doppler** | Authenticate with Doppler by providing a Personal Token. The token is validated and stored securely. |
| **Dev Setup: Fetch Secrets**    | Manually trigger secrets fetching for all workspace folders that have a configuration file. |

## Token Storage & Cross-Environment Access

The Doppler token is stored in **VS Code's SecretStorage** on your local (host) machine — not inside your project, container, or remote environment. This means:

- **One-time setup.** You configure the token once via **Dev Setup: Login to Doppler**, and it's available everywhere VS Code runs.
- **Works across environments.** Whether you're working in a Dev Container, WSL, or a standard local workspace, they all share the same stored token. No need to re-enter it when switching contexts.
- **Nothing stored in the project.** The token never appears in your repository, workspace files, or container filesystem. It lives at the VS Code installation level on your computer.

In practice, this means you can open the same project in WSL today and in a Dev Container tomorrow without reconfiguring your Doppler credentials.

## Troubleshooting

- Open the **Output** panel (`Ctrl+Shift+U` / `Cmd+Shift+U`) and select **Dev Setup** from the dropdown to see detailed logs.
- If no config file is found, the extension silently skips that workspace folder on startup. Use the manual **Fetch Secrets** command to get a warning message.
- If the Doppler token is missing or expired, the extension will prompt you to log in again.

## License

[MIT](LICENSE.md) © Pavel Purma
