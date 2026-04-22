# Lexicon Rotation Runbook

Canonical artefact: [`data/lexicons/wulo.pls`](../data/lexicons/wulo.pls)
(published by [`.github/workflows/publish-lexicon.yml`](../.github/workflows/publish-lexicon.yml))

Azure Speech / Voice Live loads the PLS via `AZURE_CUSTOM_LEXICON_URL`. The
URL points at an Azure Blob Storage container reached through a time-boxed
**SAS token** which must be rotated every **90 days** (NIST SP 800-63 key
lifetime guidance — short enough that leaks are automatically mitigated).

## 1. Secret inventory

| Secret | Scope | Holder |
| --- | --- | --- |
| `AZURE_LEXICON_STORAGE_ACCOUNT` | GitHub repo secret | storage account name |
| `AZURE_LEXICON_CONTAINER` | GitHub repo secret | blob container name (e.g. `lexicons`) |
| `AZURE_LEXICON_SAS_TOKEN` | GitHub repo secret | write-only SAS, rotated quarterly |
| `AZURE_CUSTOM_LEXICON_URL` | App Service / Container Apps config | read-only SAS URL, rotated quarterly |

Store the long-lived Storage Account key in **Azure Key Vault** and generate
SAS tokens from it — never copy the account key into CI.

## 2. 90-day rotation

Run this runbook on the first Monday of each quarter.

1. **Generate a new read-only SAS** (for runtime) with permissions `r`,
   expiry T+95 days, and IP allow-list matching the App Service outbound
   IPs (optional but preferred):
   ```bash
   az storage blob generate-sas \
     --account-name $ACCOUNT --container-name $CONTAINER --name wulo.pls \
     --permissions r --https-only \
     --expiry $(date -u -d '+95 days' +%Y-%m-%dT%H:%MZ) \
     --auth-mode login --as-user
   ```
2. **Generate a new write-only SAS** (for CI) with permissions `cw`,
   expiry T+95 days:
   ```bash
   az storage container generate-sas \
     --account-name $ACCOUNT --name $CONTAINER \
     --permissions cw --https-only \
     --expiry $(date -u -d '+95 days' +%Y-%m-%dT%H:%MZ) \
     --auth-mode login --as-user
   ```
3. **Push the new tokens into Key Vault**:
   ```bash
   az keyvault secret set --vault-name $VAULT --name LexiconReadSas --value "$READ_SAS"
   az keyvault secret set --vault-name $VAULT --name LexiconWriteSas --value "$WRITE_SAS"
   ```
4. **Update the runtime config** (`AZURE_CUSTOM_LEXICON_URL`) from Key Vault
   via the `@Microsoft.KeyVault(...)` reference pattern. The App Service
   restarts; the lexicon load is verified by `/api/health/lexicon`.
5. **Update the GitHub repo secret** `AZURE_LEXICON_SAS_TOKEN` with the new
   write-only SAS. The `publish-lexicon` workflow will pick it up on the next
   run.
6. **Smoke test**:
   ```bash
   curl -sS https://<backend>/api/health/lexicon | jq .
   ```
   Expect `"status": "ok"` and `"missing_tokens": []`.
7. **Revoke the old SAS** by re-generating the Storage Account key the
   tokens were signed against, or by shortening the expiry in the Stored
   Access Policy if one is attached.

## 3. Emergency rotation

If a SAS leaks:

1. Regenerate the Storage Account key immediately (Azure Portal → Storage →
   Access keys → Rotate key 1). Every SAS signed with that key dies.
2. Follow the 90-day rotation steps above with a fresh key.
3. File a post-mortem under `docs/incidents/`.

## 4. Audit

- CI publish runs are logged under Actions → `publish-lexicon`.
- Runtime lexicon loads are observable via `/api/health/lexicon` and the
  startup check (fatal when `WEBSITE_HOSTNAME` is set).
- Record the T+0 date of every rotation in `docs/lexicon-rotation.md#history`.

### History

| Date | Rotator | Notes |
| --- | --- | --- |
| _pending_ | — | initial 90-day rotation due once secrets are provisioned |
