# Instance branding

This directory holds deployment-specific branding that must **not** be
checked into the public repository: operator logo, legal notice (Impressum)
HTML, etc. The `.gitignore` in the repository root excludes everything in
here except this README and the `.gitkeep`.

Files the application looks for at runtime:

| Path                       | Purpose                                             |
|----------------------------|-----------------------------------------------------|
| `static/brand/logo.{png,svg}` | Header logo. Path is set via `PUBLIC_BRAND_LOGO_URL` in `.env`. |
| `static/brand/impressum.html` | HTML snippet shown in the Legal → Impressum dialog. If the file is missing, the dialog shows a neutral placeholder. |

Environment variables (`.env`) that control the header:

| Variable                  | Effect                                                            |
|---------------------------|-------------------------------------------------------------------|
| `PUBLIC_BRAND_LOGO_URL`   | URL of the operator logo. Empty → no logo shown.                  |
| `PUBLIC_BRAND_NAME`       | Short name shown next to the logo (e.g. institution lab name).    |
| `PUBLIC_BRAND_LINK`       | URL the logo links to. Empty → logo is not a link.                |
| `PUBLIC_IMPRESSUM_URL`    | Optional override for the impressum source (default: `/brand/impressum.html`). |

The hard-coded **About** dialog always shows the attribution credit to the
original authors of `transact-qda`; that credit cannot be removed by
configuration — see `COMMERCIAL-LICENSE.md` and `LICENSE` (AGPL-3.0-or-later).
